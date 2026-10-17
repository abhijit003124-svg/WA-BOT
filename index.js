
import 'dotenv/config';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  Browsers
} from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'node:fs';

const BOT_NAME = process.env.BOT_NAME || 'DEMON EYE MD';
const PREFIX = process.env.PREFIX || '.';
const OWNER_NUMBER = (process.env.OWNER_NUMBER || '')
  .replace(/\D/g, '');
const PAIRING_NUMBER = (process.env.PAIRING_NUMBER || '')
  .replace(/\D/g, '');
const SESSION_DIR = './session';

fs.mkdirSync(SESSION_DIR, { recursive: true });

let pairingRequested = false;
let reconnectTimer;
let stopping = false;
let sock;

const logger = pino({ level: 'silent' });

function getNumber(jid = '') {
  return jid.split('@')[0].split(':')[0].replace(/\D/g, '');
}

function isOwner(jid) {
  return Boolean(OWNER_NUMBER) && getNumber(jid) === OWNER_NUMBER;
}

async function startBot() {
  if (stopping) return;

  const { state, saveCreds } =
    await useMultiFileAuthState(SESSION_DIR);

  sock = makeWASocket({
    auth: state,
    logger,
    browser: Browsers.ubuntu(BOT_NAME),
    markOnlineOnConnect: false,
    syncFullHistory: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'connecting') {
      console.log('Connecting to WhatsApp...');
    }

    if (connection === 'open') {
      pairingRequested = true;
      console.log(`${BOT_NAME} connected successfully.`);
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error
        ?.output?.statusCode;

      console.log('WhatsApp connection closed:', statusCode);

      if (
        statusCode === DisconnectReason.loggedOut ||
        statusCode === DisconnectReason.badSession
      ) {
        console.log(
          'Session logged out or invalid. Check the session before reconnecting.'
        );
        return;
      }

      if (!stopping) {
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          startBot().catch(console.error);
        }, 3000);
      }
    }

    if (
      connection === 'connecting' &&
      !state.creds.registered &&
      !pairingRequested
    ) {
      if (!PAIRING_NUMBER) {
        console.log(
          'Set PAIRING_NUMBER in Pterodactyl Startup variables.'
        );
        return;
      }

      pairingRequested = true;

      try {
        await new Promise(resolve => setTimeout(resolve, 2000));

        const code = await sock.requestPairingCode(PAIRING_NUMBER);
        console.log('');
        console.log('========== PAIRING CODE ==========');
        console.log(code);
        console.log('Open WhatsApp > Linked devices > Link with phone number.');
        console.log('==================================');
      } catch (error) {
        pairingRequested = false;
        console.error('Pairing code request failed:', error.message);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      try {
        if (!msg.message || msg.key.fromMe) continue;

        const jid = msg.key.remoteJid;
        if (!jid || jid === 'status@broadcast') continue;

        const text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.imageMessage?.caption ||
          msg.message.videoMessage?.caption ||
          '';

        if (!text.startsWith(PREFIX)) continue;

        const parts = text.slice(PREFIX.length).trim().split(/\s+/);
        const command = (parts.shift() || '').toLowerCase();
        const args = parts;
        const sender = msg.key.participant || jid;
        const owner = isOwner(sender);

        const reply = async (body) => {
          await sock.sendMessage(jid, { text: body }, { quoted: msg });
        };

        switch (command) {
          case 'menu':
          case 'help':
            await reply(
`${BOT_NAME}
━━━━━━━━━━━━━━━━
${PREFIX}menu - Show commands
${PREFIX}ping - Check response
${PREFIX}alive - Bot status
${PREFIX}owner - Owner contact
${PREFIX}info - Chat information
${PREFIX}autoreply on/off - Owner only
━━━━━━━━━━━━━━━━`
            );
            break;

          case 'ping':
            await reply('Pong! 🏓');
            break;

          case 'alive':
            await reply(
              `✅ ${BOT_NAME} is online.\nUptime: ${Math.floor(process.uptime())} seconds`
            );
            break;

          case 'owner':
            await reply(
              OWNER_NUMBER
                ? `Owner: https://wa.me/${OWNER_NUMBER}`
                : 'Owner number is not configured.'
            );
            break;

          case 'info':
            await reply(
              `Bot: ${BOT_NAME}\nChat: ${jid.endsWith('@g.us') ? 'Group' : 'Private chat'}\nPrefix: ${PREFIX}`
            );
            break;

          case 'autoreply':
            if (!owner) {
              await reply('Owner only command.');
              break;
            }

            if (!['on', 'off'].includes((args[0] || '').toLowerCase())) {
              await reply(`Usage: ${PREFIX}autoreply on/off`);
              break;
            }

            fs.writeFileSync(
              './settings.json',
              JSON.stringify({
                autoreply: args[0].toLowerCase() === 'on'
              }, null, 2)
            );

            await reply(`Auto-reply ${args[0].toLowerCase()}.`);
            break;

          default:
            break;
        }
      } catch (error) {
        console.error('Message handler error:', error.message);
      }
    }
  });
}

process.on('SIGINT', () => {
  stopping = true;
  clearTimeout(reconnectTimer);
  console.log('Stopping bot...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopping = true;
  clearTimeout(reconnectTimer);
  console.log('Stopping bot...');
  process.exit(0);
});

startBot().catch(error => {
  console.error('Bot startup failed:', error);
  process.exitCode = 1;
});
