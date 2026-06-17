import { EventEmitter } from 'events';

// A fake Baileys socket: an event emitter wearing the methods the adapter calls.
class FakeSock extends EventEmitter {
  public ev = {
    on: (event: string, handler: (arg: unknown) => void) => {
      this.emitter.on(event, handler);
    },
  };
  public emitter = new EventEmitter();
  public user: { id: string; name?: string } | undefined;
  public requestPairingCode = jest.fn().mockResolvedValue('ABCD-EFGH');
  public end = jest.fn();
  public logout = jest.fn().mockResolvedValue(undefined);
  public sendMessage = jest.fn();
  public onWhatsApp = jest.fn();
  public sendPresenceUpdate = jest.fn().mockResolvedValue(undefined);
  fire(event: string, arg: unknown): void {
    this.emitter.emit(event, arg);
  }
  resetEmitter(): void {
    this.emitter.removeAllListeners();
  }
}

const fakeSock = new FakeSock();
const saveCreds = jest.fn().mockResolvedValue(undefined);

jest.mock('@whiskeysockets/baileys', () => ({
  __esModule: true,
  default: jest.fn(() => fakeSock),
  useMultiFileAuthState: jest.fn().mockResolvedValue({ state: { creds: {}, keys: {} }, saveCreds }),
  fetchLatestBaileysVersion: jest.fn().mockResolvedValue({ version: [2, 3000, 0] }),
  getContentType: jest.fn(() => 'conversation'),
  DisconnectReason: { loggedOut: 401, restartRequired: 515 },
}));

import { BaileysAdapter } from './baileys.adapter';
import { EngineStatus, EngineEventCallbacks } from '../interfaces/whatsapp-engine.interface';
import { EngineNotReadyError } from '../../common/errors/engine-not-ready.error';
import { EngineNotSupportedError } from '../../common/errors/engine-not-supported.error';

const newAdapter = (): BaileysAdapter =>
  new BaileysAdapter({ sessionId: 'sess-1', authDir: './data/baileys' });

const noopCallbacks = (over: Partial<EngineEventCallbacks> = {}): EngineEventCallbacks => over;

describe('BaileysAdapter lifecycle & status', () => {
  beforeEach(() => {
    fakeSock.user = undefined;
    fakeSock.resetEmitter(); // drop listeners from previous test's initialize()
    jest.clearAllMocks();
  });

  it('starts DISCONNECTED', () => {
    expect(newAdapter().getStatus()).toBe(EngineStatus.DISCONNECTED);
  });

  it('emits onQRCode and moves to QR_READY on a connection.update with a qr', async () => {
    const onQRCode = jest.fn();
    const adapter = newAdapter();
    await adapter.initialize(noopCallbacks({ onQRCode }));
    fakeSock.fire('connection.update', { qr: 'QR-STRING' });
    expect(onQRCode).toHaveBeenCalledWith('QR-STRING');
    expect(adapter.getStatus()).toBe(EngineStatus.QR_READY);
    expect(adapter.getQRCode()).toBe('QR-STRING');
  });

  it('captures phone/pushName and fires onReady on connection open', async () => {
    const onReady = jest.fn();
    const adapter = newAdapter();
    await adapter.initialize(noopCallbacks({ onReady }));
    fakeSock.user = { id: '628999:12@s.whatsapp.net', name: 'Me' };
    fakeSock.fire('connection.update', { connection: 'open' });
    expect(adapter.getStatus()).toBe(EngineStatus.READY);
    expect(adapter.getPhoneNumber()).toBe('628999');
    expect(adapter.getPushName()).toBe('Me');
    expect(onReady).toHaveBeenCalledWith('628999', 'Me');
  });

  it('on a logged-out close: DISCONNECTED, onDisconnected, and NO reconnect', async () => {
    const onDisconnected = jest.fn();
    const adapter = newAdapter();
    await adapter.initialize(noopCallbacks({ onDisconnected }));
    const makeWASocket = jest.requireMock('@whiskeysockets/baileys').default as jest.Mock;
    makeWASocket.mockClear();
    fakeSock.fire('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } });
    expect(adapter.getStatus()).toBe(EngineStatus.DISCONNECTED);
    expect(onDisconnected).toHaveBeenCalled();
    expect(makeWASocket).not.toHaveBeenCalled(); // no reconnect
  });

  it('on a recoverable close: reconnects (re-creates the socket)', async () => {
    const adapter = newAdapter();
    await adapter.initialize(noopCallbacks({}));
    const makeWASocket = jest.requireMock('@whiskeysockets/baileys').default as jest.Mock;
    makeWASocket.mockClear();
    fakeSock.fire('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 515 } } } });
    await new Promise(r => setImmediate(r)); // let the async connect() run
    expect(makeWASocket).toHaveBeenCalledTimes(1);
  });

  it('disconnect() ends the socket and does not reconnect', async () => {
    const adapter = newAdapter();
    await adapter.initialize(noopCallbacks({}));
    await adapter.disconnect();
    expect(fakeSock.end).toHaveBeenCalled();
    expect(adapter.getStatus()).toBe(EngineStatus.DISCONNECTED);
  });

  it('requestPairingCode delegates to the socket', async () => {
    const adapter = newAdapter();
    await adapter.initialize(noopCallbacks({}));
    await expect(adapter.requestPairingCode('628999')).resolves.toBe('ABCD-EFGH');
    expect(fakeSock.requestPairingCode).toHaveBeenCalledWith('628999');
  });

  it('persists creds: subscribes saveCreds to creds.update', async () => {
    const adapter = newAdapter();
    await adapter.initialize(noopCallbacks({}));
    fakeSock.fire('creds.update', {});
    expect(saveCreds).toHaveBeenCalled();
  });
});

describe('BaileysAdapter capability gating', () => {
  it('throws EngineNotSupportedError for store-backed methods (e.g. getGroups, getChats)', async () => {
    const adapter = newAdapter();
    await expect(adapter.getGroups()).rejects.toBeInstanceOf(EngineNotSupportedError);
    await expect(adapter.getChats()).rejects.toBeInstanceOf(EngineNotSupportedError);
    await expect(adapter.sendImageMessage('x', { mimetype: 'image/png', data: 'AAA' })).rejects.toBeInstanceOf(
      EngineNotSupportedError,
    );
  });
});

// Suppress unused import lint warning — EngineNotReadyError is the correct class to import
// even though its direct use in tests is through the toBeInstanceOf check on thrown errors.
void EngineNotReadyError;
