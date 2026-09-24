import { io } from 'socket.io-client';
import * as Y from 'yjs';

const PROPERTY_DEFINITIONS_DOC = 'db$docCustomPropertyInfo';
const PROPERTY_VALUES_DOC = 'db$docProperties';
const CUSTOM_PREFIX = 'custom:';
const DEFAULT_TIMEOUT_MS = 10_000;

export class AffinePropertyReader {
  constructor(config) {
    this.config = config;
    this.snapshot = null;
  }

  async getTextProperty(docId, propertyName) {
    if (!propertyName) return null;
    const { definitions, values } = await this.loadSnapshot();
    const normalized = propertyName.trim().toLowerCase();
    const matches = definitions.filter(definition => definition.name?.trim().toLowerCase() === normalized || definition.id === propertyName);
    if (matches.length > 1) throw new Error(`AFFiNE custom property '${propertyName}' is ambiguous. Rename duplicates or configure its property ID.`);
    if (!matches.length) return null;
    const definition = matches[0];
    if (definition.type !== 'text') throw new Error(`AFFiNE custom property '${propertyName}' must be a text property, not '${definition.type}'.`);
    const raw = values.get(docId)?.[`${CUSTOM_PREFIX}${definition.id}`];
    return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  }

  async loadSnapshot() {
    if (!this.snapshot) this.snapshot = loadPropertySnapshot(this.config);
    return this.snapshot;
  }
}

async function loadPropertySnapshot(config) {
  const socket = await connect(config);
  try {
    await emitWithAck(socket, 'space:join', {
      spaceType: 'workspace',
      spaceId: config.workspaceId,
      clientVersion: process.env.AFFINE_WS_CLIENT_VERSION || '0.26.0'
    });
    const definitionsDoc = await loadSubdocument(socket, config.workspaceId, PROPERTY_DEFINITIONS_DOC);
    const valuesDoc = await loadSubdocument(socket, config.workspaceId, PROPERTY_VALUES_DOC);
    return {
      definitions: readDefinitions(definitionsDoc),
      values: readRecords(valuesDoc)
    };
  } finally {
    socket.disconnect();
  }
}

function connect(config) {
  const endpoint = new URL(config.baseUrl);
  const extraHeaders = config.token ? { Authorization: `Bearer ${config.token}` } : undefined;
  return new Promise((resolve, reject) => {
    const socket = io(endpoint.origin, {
      transports: ['websocket'],
      path: '/socket.io/',
      extraHeaders,
      autoConnect: true,
      forceNew: true,
      reconnection: false
    });
    const timeout = setTimeout(() => finish(new Error(`AFFiNE property socket connection timed out after ${DEFAULT_TIMEOUT_MS}ms.`)), DEFAULT_TIMEOUT_MS);
    const finish = error => {
      clearTimeout(timeout);
      socket.off('connect', onConnect);
      socket.off('connect_error', onError);
      if (error) {
        socket.disconnect();
        reject(error);
      } else {
        resolve(socket);
      }
    };
    const onConnect = () => finish();
    const onError = error => finish(error instanceof Error ? error : new Error(String(error)));
    socket.on('connect', onConnect);
    socket.on('connect_error', onError);
  });
}

function emitWithAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${event} timed out after ${DEFAULT_TIMEOUT_MS}ms.`)), DEFAULT_TIMEOUT_MS);
    socket.emit(event, payload, ack => {
      clearTimeout(timeout);
      const message = typeof ack?.error === 'string' ? ack.error : ack?.error?.message;
      if (event === 'space:load-doc' && ack?.error?.name === 'DOC_NOT_FOUND') resolve({});
      else if (message) reject(new Error(`${event}: ${message}`));
      else resolve(ack?.data ?? {});
    });
  });
}

async function loadSubdocument(socket, workspaceId, docId) {
  const data = await emitWithAck(socket, 'space:load-doc', { spaceType: 'workspace', spaceId: workspaceId, docId });
  const doc = new Y.Doc();
  if (data.missing) Y.applyUpdate(doc, Buffer.from(data.missing, 'base64'));
  return doc;
}

function readDefinitions(doc) {
  const definitions = [];
  for (const key of doc.share.keys()) {
    const record = doc.getMap(key).toJSON();
    if (record.$$DELETED === true || record.isDeleted === true || !Object.keys(record).length) continue;
    definitions.push({
      id: typeof record.id === 'string' ? record.id : key,
      name: typeof record.name === 'string' ? record.name : null,
      type: typeof record.type === 'string' ? record.type : 'unknown'
    });
  }
  return definitions;
}

function readRecords(doc) {
  const records = new Map();
  for (const key of doc.share.keys()) records.set(key, doc.getMap(key).toJSON());
  return records;
}
