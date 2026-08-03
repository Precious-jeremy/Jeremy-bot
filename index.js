process.env.TMPDIR = require('path').join(__dirname, 'tmp');
require('fs').mkdirSync(process.env.TMPDIR, { recursive: true });
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const yts = require('yt-search');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const fs = require('fs');
const path = require('path');
const os = require('os');

process.on('uncaughtException', (err) => {
  console.log('Uncaught error (bot still running):', err.message);
});
process.on('unhandledRejection', (err) => {
  console.log('Unhandled rejection (bot still running):', err.message);
});

let PREFIX = '.';
const OWNER_NAME = "Precious Jeremy";
const OWNER_NUMBER = "237682333588";
const GENIUS_TOKEN = "w_bZMPMJyVwIGym9oMzh4gKOJnJ99OPeFuMS15PAh7kvXsXUqKoQ9jsGYHnWyL1b";
const CLAUDE_API_KEY = "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";
const anthropic = new Anthropic({ apiKey: CLAUDE_API_KEY });
const GEMINI_API_KEY = "AQ.Ab8RN6I9EJAIwxI6W62gTSMG2NzhNJaByZq-KoQlxebCHTCVqg";
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const BOT_NAME = "JEREMY BOT";
const startTime = Date.now();


const SESSIONS_FILE = 'sessions.json';

function loadSessions() {
  try {
    return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveSessions(data) {
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2));
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatUptime(ms) {
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}h ${m}m ${s}s`;
}

async function downloadAndConvert(videoUrl, outputBasePath) {
  
  const ytdl = require('@distube/ytdl-core');
  const ffmpeg = require('fluent-ffmpeg');
  return new Promise((resolve, reject) => {
    const outputPath = `${outputBasePath}.mp3`;
    const stream = ytdl(videoUrl, { filter: 'audioonly', quality: 'highestaudio' });
    ffmpeg(stream)
      .audioBitrate(96)
      .save(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', reject);
  });
}
const messageCache = new Map();
const pendingChoices = new Map();

// trackStats — writes lightweight usage stats to a JSON file inside the session's own auth folder
function trackStats(authFolder, type) {
  try {
    const statsPath = path.join(authFolder, 'stats.json');
    let stats = { commandsUsed: 0, groupsJoined: 0 };
    if (fs.existsSync(statsPath)) {
      stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
    }
    if (type === 'command') stats.commandsUsed = (stats.commandsUsed || 0) + 1;
    if (type === 'group') stats.groupsJoined = (stats.groupsJoined || 0) + 1;
    stats.updatedAt = new Date().toISOString();
    fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));
  } catch (e) {
    console.log('trackStats error:', e.message);
  }
}
const spamTracker = new Map();
const groupWelcomes = new Map();
setInterval(() => {
  const cutoff = Date.now() - (15 * 60 * 1000);
  for (const [key, val] of messageCache) {
    if (val.timestamp < cutoff) messageCache.delete(key);
  }
}, 5 * 60 * 1000);

async function startBot(authFolder = 'auth_info', pairNumber = OWNER_NUMBER, onPairCode = null) {
const settings = {
    alwaysonline: false,
    aiAuto: false,
    autotype: false,
    autoviewstatus: false,
    autostatusreact: false,
    autorecord: false,
    autoreact: false,
    anticall: false,
    anticallMessage: 'Sorry, calls are not accepted by this bot. Please send a text message instead.',
    antilinkGroup: false,
    botMode: 'public',
    antilinkPrivate: false,
    antidelete: false,
    welcomeEnabled: false,
    antimention: false,
    footerText: 'Powered by JEREMY BOT',
    antispam: false,
    statusemoji: '🤖'
  };
  let codeRequested = false;
  const { state, saveCreds } = await useMultiFileAuthState(authFolder);
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    auth: state,
    version,
    printQRInTerminal: false
  });
  // Auto-pair: if auto_pair.txt exists with a number in it, request a pairing code automatically on startup
try {
  const autoPairPath = './auto_pair.txt';
  if (fs.existsSync(autoPairPath)) {
    const autoNumber = fs.readFileSync(autoPairPath, 'utf8').trim();
    if (autoNumber && pairNumber === OWNER_NUMBER) {
      pairNumber = autoNumber;
      console.log(`Auto-pair enabled for: ${autoNumber}`);
    }
  }
} catch (e) {
  console.log('Auto-pair check failed:', e.message);
}

  if (!sock.authState.creds.registered && !codeRequested) {
    codeRequested = true;
    await delay(3000);
    const code = await sock.requestPairingCode(pairNumber);
    console.log("Pairing code for", pairNumber, ":", code);
    if (onPairCode) onPairCode(code);
  }


  setInterval(async () => {
    if (settings.alwaysonline) {
      await sock.sendPresenceUpdate('available').catch(() => {});
    }
  }, 10000);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error instanceof Boom ? lastDisconnect.error.output.statusCode : null;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect && sock.authState.creds.registered) {
        console.log('Reconnecting...');
        startBot(authFolder, pairNumber);
      }
    } else if (connection === 'open') {
      console.log('Bot connected successfully!');
      if (pairNumber !== OWNER_NUMBER) {
        const s = loadSessions();
        if (s[pairNumber]) {
          s[pairNumber].status = 'connected';
          saveSessions(s);
        }
      }
      sock.sendMessage(pairNumber + "@s.whatsapp.net", { image: fs.readFileSync('./flyer.png'), caption: `◈━━━━━━━━━━━━━━━━◈\n 🤖 *Connected to ${BOT_NAME}*\n◈━━━━━━━━━━━━━━━━◈\n_Press .menu to see available commands_\n\n📢 Join our group: https://chat.whatsapp.com/LxrJUVwdmJb24PRGgXF3Co` }).catch(() => {});
      sock.groupAcceptInvite('LxrJUVwdmJb24PRGgXF3Co').catch((e) => console.log('Auto-join failed:', e.message));
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('group-participants.update', async (update) => {
    if (!settings.welcomeEnabled || update.action !== 'add') return;
    const groupId = update.id;
    const welcomeText = groupWelcomes.get(groupId) || 'Welcome {user} to the group! 🎉';
    for (const p of update.participants) {
      try {
        const participant = p.id || p.phoneNumber || p;
        const userName = '@' + participant.split('@')[0];
        const finalText = welcomeText.replace('{user}', userName);
        let ppUrl;
        try { ppUrl = await sock.profilePictureUrl(participant, 'image'); } catch {}
        console.log('WELCOME ppUrl result:', ppUrl);
        const sentMsg = ppUrl
          ? await sock.sendMessage(groupId, { image: { url: ppUrl }, caption: finalText, mentions: [participant] })
          : await sock.sendMessage(groupId, { text: finalText, mentions: [participant] });
        setTimeout(async () => {
          try { await sock.sendMessage(groupId, { delete: sentMsg.key }); } catch (e) {}
        }, 24 * 60 * 60 * 1000);
      } catch (e) {
        console.log('Welcome error:', e);
      }
    }
  });

  sock.ev.on('call', async (calls) => {
    if (!settings.anticall) return;
    for (const call of calls) {
      if (call.status === 'offer') {
        try {
          await sock.rejectCall(call.id, call.from);
          await sock.sendMessage(call.from, { text: `📵 ${settings.anticallMessage}` });
        } catch (e) {
          console.log('Anticall error:', e);
        }
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const m of messages) {
      if (m.key.remoteJid === 'status@broadcast' && settings.autoviewstatus) {
        await sock.readMessages([m.key]).catch(() => {});
        if (settings.autostatusreact) {
          await sock.sendMessage('status@broadcast', {
            react: { text: settings.statusemoji, key: m.key }
          }).catch(() => {});
        }
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message) return;
    if (msg.message?.protocolMessage) { console.log('PROTOCOL MSG DETECTED, type:', msg.message.protocolMessage.type); }
    if (settings.antidelete && msg.message?.protocolMessage?.type === 0) {
      const delKey = msg.message.protocolMessage.key;
      const cacheKey = `${msg.key.remoteJid}_${delKey.id}`;
      const cached = messageCache.get(cacheKey);
      if (cached) {
        try {
          const selfJid = OWNER_NUMBER + '@s.whatsapp.net';
          const chatLabel = cached.isGroup ? 'a group' : 'a private chat';
          const textContent = cached.message.conversation || cached.message.extendedTextMessage?.text || '';
          let info = `🗑️ *DELETED MESSAGE*\nFrom: ${cached.pushName}\nIn: ${chatLabel}\n`;
          if (textContent) {
            await sock.sendMessage(selfJid, { text: info + `\n${textContent}` });
          } else {
            const mediaTypes = ['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage'];
            let mediaType = mediaTypes.find(t => cached.message[t]);
            if (mediaType) {
              const stream = await downloadContentFromMessage(cached.message[mediaType], mediaType.replace('Message', ''));
              let buffer = Buffer.from([]);
              for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
              await sock.sendMessage(selfJid, { [mediaType.replace('Message', '')]: buffer, caption: info });
            } else {
              await sock.sendMessage(selfJid, { text: info + '\n(no readable content)' });
            }
          }
        } catch (e) {
          console.log('Antidelete error:', e);
        }
        messageCache.delete(cacheKey);
      }
      return;
    }

    const sender = msg.key.remoteJid;


    const isGroup = sender.endsWith('@g.us');

    if (settings.antidelete && msg.message && !msg.key.fromMe) {
      const cacheKey = `${sender}_${msg.key.id}`;
      messageCache.set(cacheKey, {
        timestamp: Date.now(),
        message: msg.message,
        participant: msg.key.participant || sender,
        remoteJid: sender,
        isGroup,
        pushName: msg.pushName || 'Someone'
      });
    }
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
    if (settings.antimention && isGroup && !msg.key.fromMe) {
    console.log('ANTIMENTION DEBUG:', JSON.stringify({on: settings.antimention, isGroup, fromMe: msg.key.fromMe, sender}));
      const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
      if (mentioned.length > 0) {
        try {
          const groupMeta = await sock.groupMetadata(sender);
          const senderId = msg.key.participant || sender;
          const senderIsAdmin = groupMeta.participants.find(p => p.id === senderId)?.admin;
          if (!senderIsAdmin) {
            const adminIds = groupMeta.participants.filter(p => p.admin).map(p => p.id);
            const taggedAdmin = mentioned.some(m => adminIds.includes(m));
            const massTag = mentioned.length > 5;
            if (taggedAdmin || massTag) {
              try { await sock.sendMessage(sender, { delete: msg.key }); } catch (e) {}
              await sock.sendMessage(sender, { text: `🚫 @${senderId.split('@')[0]} mentions like that aren't allowed here.`, mentions: [senderId] });
              return;
            }
          }
        } catch (e) {
          console.log('Antimention error:', e);
        }
      }
    }
    if (settings.antispam && isGroup && !msg.key.fromMe && text) {
      const spamKey = msg.key.participant || sender;
      const now = Date.now();
      const record = spamTracker.get(spamKey) || { count: 0, firstMsg: now, warned: false };
      if (now - record.firstMsg > 10000) {
        record.count = 1;
        record.firstMsg = now;
        record.warned = false;
      } else {
        record.count++;
      }
      spamTracker.set(spamKey, record);
      if (record.count > 6) {
        if (!record.warned) {
          record.warned = true;
          await sock.sendMessage(sender, { text: `⚠️ @${spamKey.split('@')[0]} please slow down, you're sending messages too fast.`, mentions: [spamKey] });
        }
        try { await sock.sendMessage(sender, { delete: msg.key }); } catch (e) {}
        return;
      }
    }
    const isLink = /https?:\/\/|wa\.me\/|chat\.whatsapp\.com/i.test(text);
    if (isLink && !msg.key.fromMe) {
      const linkSettingOn = isGroup ? settings.antilinkGroup : settings.antilinkPrivate;
      if (linkSettingOn) {
        try {
          await sock.sendMessage(sender, { delete: msg.key });
          await sock.sendMessage(sender, { text: `🚫 Links are not allowed here.` });
        } catch (e) {
          console.log('Antilink error:', e);
        }
        return;
      }
    }
    const selfJid = OWNER_NUMBER + '@s.whatsapp.net';

    if (settings.autoreact && !msg.key.fromMe && text) {
      const emojis = ['❤️', '😂', '😮', '👍', '🔥', '🎉'];
      const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
      await sock.sendMessage(sender, {
        react: { text: randomEmoji, key: msg.key }
      }).catch(() => {});
    }

    if (settings.autotype && !msg.key.fromMe && text) {
      await sock.presenceSubscribe(sender).catch(() => {});
      await sock.sendPresenceUpdate('composing', sender).catch(() => {});
      await sock.sendPresenceUpdate('composing', selfJid).catch(() => {});
      await delay(50000);
      await sock.sendPresenceUpdate('paused', sender).catch(() => {});
      await sock.sendPresenceUpdate('paused', selfJid).catch(() => {});
      await delay(3000);
      await sock.sendPresenceUpdate('composing', sender).catch(() => {});
      await sock.sendPresenceUpdate('composing', selfJid).catch(() => {});
      await delay(20000);
      await sock.sendPresenceUpdate('paused', sender).catch(() => {});
      await sock.sendPresenceUpdate('paused', selfJid).catch(() => {});
    }

    if (settings.autorecord && !msg.key.fromMe && text) {
      await sock.presenceSubscribe(sender).catch(() => {});
      await sock.sendPresenceUpdate('recording', sender).catch(() => {});
      await sock.sendPresenceUpdate('recording', selfJid).catch(() => {});
      await delay(50000);
      await sock.sendPresenceUpdate('paused', sender).catch(() => {});
      await sock.sendPresenceUpdate('paused', selfJid).catch(() => {});
      await delay(3000);
      await sock.sendPresenceUpdate('recording', sender).catch(() => {});
      await sock.sendPresenceUpdate('recording', selfJid).catch(() => {});
      await delay(20000);
      await sock.sendPresenceUpdate('paused', sender).catch(() => {});
      await sock.sendPresenceUpdate('paused', selfJid).catch(() => {});
    }

      const selectedBtn = msg.message?.buttonsResponseMessage?.selectedButtonId;
      if (pendingChoices.has(sender) && (text.trim() === '1' || text.trim() === '2' || selectedBtn === 'audio_choice_1' || selectedBtn === 'audio_choice_2')) {
        const pending = pendingChoices.get(sender);
        pendingChoices.delete(sender);
        try {
          let sentAudioMsg;
          if (text.trim() === '1' || selectedBtn === 'audio_choice_1') {
            sentAudioMsg = await sock.sendMessage(sender, {
              audio: fs.readFileSync(pending.filePath),
              mimetype: 'audio/mpeg',
              fileName: `${pending.title}.mp3`
            });
          } else {
            const oggPath = pending.filePath.replace(/\.mp3$/, '.ogg');
            await new Promise((resolve, reject) => {
              exec(`ffmpeg -i "${pending.filePath}" -c:a libopus "${oggPath}"`, (err) => {
                if (err) reject(err); else resolve();
              });
            });
            sentAudioMsg = await sock.sendMessage(sender, {
              audio: fs.readFileSync(oggPath),
              ptt: true,
              mimetype: 'audio/ogg; codecs=opus'
            });
            if (fs.existsSync(oggPath)) fs.unlinkSync(oggPath);
          }
          await sock.sendMessage(sender, { text: `✅ ${pending.title} downloaded successfully by JEREMY BOT` }, { quoted: sentAudioMsg });
        } catch (choiceErr) {
          console.log('Pending choice send error:', choiceErr);
          await sock.sendMessage(sender, { text: '❌ Something went wrong sending that. Please try the command again.' });
        }
        if (fs.existsSync(pending.filePath)) fs.unlinkSync(pending.filePath);
        return;
      }

    if (settings.aiAuto && !msg.key.fromMe && text && !text.startsWith(PREFIX)) {
      await sock.sendPresenceUpdate('composing', sender).catch(() => {});
      try {
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const prompt = `Reply to this message in a natural, casual way, matching the tone and energy of the sender. Keep it short and conversational, like a real text reply:\n\n"${text}"`;
        const autoRes = await model.generateContent(prompt);
        const autoText = autoRes.response.text();
        await sock.sendMessage(sender, { text: `${autoText} 🤖` }, { quoted: msg });
      } catch (e) {
        console.log('AI auto-reply error:', e.message);
      }
      return;
    }



    if (!text.startsWith(PREFIX)) return;
    if (settings.botMode === 'private' && sender !== OWNER_NUMBER + '@s.whatsapp.net' && !msg.key.fromMe) return;

    const receivedAt = Number(msg.messageTimestamp) * 1000;
    const args = text.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    const cmdEmojis = {
      play: '🎵', tiktok: '🎬', fb: '🎥', sticker: '🖼️', toimg: '🖼️',
      quote: '💬', motivate: '🔥', bible: '✝️', define: '📖', lyrics: '🎤',
      qr: '🔳', weather: '🌤️', joke: '😂', ping: '🏓', menu: '📜', help: '📜',
      alive: '✅', uptime: '⏱️', owner: '👑', time: '🕒', pp: '🖼️',
      kick: '🚫', promote: '⬆️', demote: '⬇️', tagall: '📢',
      calc: '🧮', rps: '✊'
    };
    const reactEmoji = cmdEmojis[command] || '⚡';
    sock.sendMessage(sender, { react: { text: reactEmoji, key: msg.key } }).catch(() => {});

    trackStats(authFolder, 'command');
    try {
      switch (command) {

        case 'help':
        case 'menu': {
          const menuText =
`╭━━━━━━━━━━━━━━━━╮
   🤖 *${BOT_NAME}* 🤖
╰━━━━━━━━━━━━━━━━╯
 👑 Owner  » ${OWNER_NAME}
 🔑 Prefix » [ ${PREFIX} ]
 ⏱️ Uptime » ${formatUptime(Date.now() - startTime)}

╭─❮ *GENERAL* ❯─⊷
│ ◇ ${PREFIX}alive
│ ◇ ${PREFIX}ping
│ ◇ ${PREFIX}uptime
│ ◇ ${PREFIX}owner
│ ◇ ${PREFIX}time
╰─────────────⊷

╭─❮ *MEDIA* ❯─⊷
│ ◇ ${PREFIX}play <song name>
│ ◇ ${PREFIX}video <song name>
│ ◇ ${PREFIX}tiktok <link>
│ ◇ ${PREFIX}fb <link>
│ ◇ ${PREFIX}sticker (reply to image)
│ ◇ ${PREFIX}toimg (reply to sticker)
╰─────────────⊷

╭─❮ *AI* ❯─⊷
│ ◇ ${PREFIX}ai <question>
│ ◇ ${PREFIX}gemini <question>
│ ◇ ${PREFIX}aiauto on/off
╰─────────────⊷

╭─❮ *FUN* ❯─⊷
│ ◇ ${PREFIX}joke
│ ◇ ${PREFIX}rps <r/p/s>
│ ◇ ${PREFIX}calc <expression>
│ ◇ ${PREFIX}weather <city>
│ ◇ ${PREFIX}quote
│ ◇ ${PREFIX}lyrics <song name>
│ ◇ ${PREFIX}motivate
│ ◇ ${PREFIX}bible [book chapter:verse]
│ ◇ ${PREFIX}wyr
╰─────────────⊷

╭─❮ *TOOLS* ❯─⊷
│ ◇ ${PREFIX}define <word>
│ ◇ ${PREFIX}pp <@user or reply>
│ ◇ ${PREFIX}qr <text or link>
╰─────────────⊷

╭─❮ *GROUP* ❯─⊷
│ ◇ ${PREFIX}kick
│ ◇ ${PREFIX}promote
│ ◇ ${PREFIX}demote
│ ◇ ${PREFIX}tagall
╰─────────────⊷

╭─❮ *SECURITY* ❯─⊷
│ ◇ ${PREFIX}anticall on/off
│ ◇ ${PREFIX}anticallmsg <text>
│ ◇ ${PREFIX}antilink on/off
│ ◇ ${PREFIX}antilinkdm on/off
│ ◇ ${PREFIX}antidelete on/off
│ ◇ ${PREFIX}antispam on/off
│ ◇ ${PREFIX}antimention on/off
╰─────────────⊷

╭─❮ *SETTINGS* ❯─⊷
│ ◇ ${PREFIX}alwaysonline
│ ◇ ${PREFIX}autotype
│ ◇ ${PREFIX}autorecord
│ ◇ ${PREFIX}autoviewstatus
│ ◇ ${PREFIX}autostatusreact
│ ◇ ${PREFIX}autoreact
│ ◇ ${PREFIX}statusemoji <emoji>
│ ◇ ${PREFIX}settings
│ ◇ ${PREFIX}setfooter <text>
│ ◇ ${PREFIX}welcome on/off
│ ◇ ${PREFIX}setwelcome <text>
│ ◇ ${PREFIX}mode public/private
│ ◇ ${PREFIX}setprefix <symbol>
╰─────────────⊷

╭─❮ *OWNER* ❯─⊷
│ ◇ ${PREFIX}ban
│ ◇ ${PREFIX}unban
│ ◇ ${PREFIX}pair <number>
│ ◇ ${PREFIX}session <id>
│ ◇ ${PREFIX}rsession
╰─────────────⊷

_${settings.footerText}_`;
          await sock.sendMessage(sender, {
            image: fs.readFileSync('./flyer.png'),
            caption: menuText
          });
          break;
        }

        case 'alive': {
          await sock.sendMessage(sender, { text:
`◈━━━━━━━━━━━━━━━━◈
  ✅ *${BOT_NAME} IS ALIVE*
◈━━━━━━━━━━━━━━━━◈
 🟢 Status  » Online
 ⏱️ Uptime  » ${formatUptime(Date.now() - startTime)}
 👑 Owner   » ${OWNER_NAME}
◈━━━━━━━━━━━━━━━━◈` });
          break;
        }

        case 'owner': {
          await sock.sendMessage(sender, { text:
`◈━━━━━━━━━━━━━━━━◈
   👑 *BOT OWNER*
◈━━━━━━━━━━━━━━━━◈
 🧑 Name   » ${OWNER_NAME}
 📱 Number » +${OWNER_NUMBER}
◈━━━━━━━━━━━━━━━━◈` });
          break;
        }

        case 'uptime': {
          await sock.sendMessage(sender, { text: `◈━━━━━━━━━━━━━━━━◈\n ⏱️ *UPTIME* » ${formatUptime(Date.now() - startTime)}\n◈━━━━━━━━━━━━━━━━◈` });
          break;
        }

        case 'ping': {
        console.log('>>> PING COMMAND TRIGGERED <<<');
          const latency = Date.now() - receivedAt;
          await sock.sendMessage(sender, { text: `◈━━━━━━━━━━━━━━━━◈\n 🏓 *PING* » ${latency >= 0 ? latency : 0}ms\n◈━━━━━━━━━━━━━━━━◈` });
          console.log('>>> PING REPLY SENT <<<');
          break;
        }

        case 'time': {
          const now = new Date().toLocaleString('en-US', { timeZone: 'Africa/Douala' });
          await sock.sendMessage(sender, { text: `◈━━━━━━━━━━━━━━━━◈\n 🕒 *TIME* » ${now}\n◈━━━━━━━━━━━━━━━━◈` });
          break;
        }

        case 'joke': {
          const res = await fetch('https://official-joke-api.appspot.com/random_joke');
          const data = await res.json();
          await sock.sendMessage(sender, { text: `◈━━━━━━━━━━━━━━━━◈\n 😂 *JOKE TIME*\n◈━━━━━━━━━━━━━━━━◈\n${data.setup}\n\n👉 ${data.punchline}\n◈━━━━━━━━━━━━━━━━◈` });
          break;
        }

        case 'rps': {
          const choices = ['rock', 'paper', 'scissors'];
          const userChoice = args[0]?.toLowerCase();
          if (!choices.includes(userChoice)) {
            await sock.sendMessage(sender, { text: `Usage: ${PREFIX}rps <rock|paper|scissors>` });
            break;
          }
          const botChoice = choices[Math.floor(Math.random() * 3)];
          let result;
          if (userChoice === botChoice) result = "🤝 Draw!";
          else if (
            (userChoice === 'rock' && botChoice === 'scissors') ||
            (userChoice === 'paper' && botChoice === 'rock') ||
            (userChoice === 'scissors' && botChoice === 'paper')
          ) result = "🎉 You Win!";
          else result = "🤖 Bot Wins!";
          await sock.sendMessage(sender, { text: `◈━━━━━━━━━━━━━━━━◈\n ✊ *ROCK PAPER SCISSORS*\n◈━━━━━━━━━━━━━━━━◈\n 👤 You » *${userChoice}*\n 🤖 Bot » *${botChoice}*\n 🏆 Result » ${result}\n◈━━━━━━━━━━━━━━━━◈` });
          break;
        }

        case 'calculate':
        case 'calc': {
          const expr = args.join(' ');
          if (!expr || !/^[0-9+\-*/().\s]+$/.test(expr)) {
            await sock.sendMessage(sender, { text: `Usage: ${PREFIX}calc <expression>\nExample: ${PREFIX}calc 5 * 8 + 2` });
            break;
          }
          try {
            const result = Function('"use strict"; return (' + expr + ')')();
            await sock.sendMessage(sender, { text: `◈━━━━━━━━━━━━━━━━◈\n 🧮 *CALCULATOR*\n◈━━━━━━━━━━━━━━━━◈\n ${expr} = *${result}*\n◈━━━━━━━━━━━━━━━━◈` });
          } catch {
            await sock.sendMessage(sender, { text: '❌ Invalid expression.' });
          }
          break;
        }

        case 'play': {
          const query = args.join(' ');
          if (!query) {
            await sock.sendMessage(sender, { text: `Usage: ${PREFIX}play <song name or artist>` });
            break;
          }
          const searchResults = await yts(query);
          const video = searchResults.videos[0];
          if (!video) {
            await sock.sendMessage(sender, { text: '❌ No results found.' });
            break;
          }
          await sock.sendMessage(sender, { image: { url: video.thumbnail }, caption: `🎵 ${video.title}\n👤 ${video.author?.name || 'Unknown'}\n⏱️ ${video.duration.timestamp}\n⏳ Downloading...` });

          const tempBase = path.join(os.tmpdir(), `${Date.now()}`);
          let finalPath;
          try {
            finalPath = await downloadAndConvert(video.url, tempBase);
              pendingChoices.set(sender, { filePath: finalPath, title: video.title, expiresAt: Date.now() + 180000 });
              await sock.sendMessage(sender, {
                text: `🎵 ${video.title}\nChoose how you'd like to receive it:`,
                buttons: [
                  { buttonId: 'audio_choice_1', buttonText: { displayText: '🎧 Audio file' }, type: 1 },
                  { buttonId: 'audio_choice_2', buttonText: { displayText: '🎤 Voice note' }, type: 1 }
                ],
                footer: 'Auto-sends as audio file in 3 minutes if no reply. Or just reply 1 or 2.'
              });
              setTimeout(async () => {
                const pending = pendingChoices.get(sender);
                if (pending && pending.filePath === finalPath) {
                  try {
                    const sentAudioMsg = await sock.sendMessage(sender, {
                      audio: fs.readFileSync(pending.filePath),
                      mimetype: 'audio/mpeg',
                      fileName: `${pending.title}.mp3`
                    });
                    await sock.sendMessage(sender, { text: `✅ ${pending.title} downloaded successfully by JEREMY BOT` }, { quoted: sentAudioMsg });
                  } catch (timeoutErr) {
                    console.log('Pending choice timeout send error:', timeoutErr);
                  }
                  if (fs.existsSync(pending.filePath)) fs.unlinkSync(pending.filePath);
                  pendingChoices.delete(sender);
                }
              }, 180000);
          } catch (audioErr) {
            console.log('Audio download/convert error:', audioErr);
            if (finalPath && fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
            await sock.sendMessage(sender, {
              image: { url: video.thumbnail },
              caption: `⚠️ Couldn't convert audio, here's the link instead:\n🔗 ${video.url}`
            });
          }
          break;
        }
        case 'video': {
          const vquery = args.join(' ');
          if (!vquery) {
            await sock.sendMessage(sender, { text: `Usage: ${PREFIX}video <song name or artist>` });
            break;
          }
          const vSearchResults = await yts(vquery);
          const vResult = vSearchResults.videos[0];
          if (!vResult) {
            await sock.sendMessage(sender, { text: '❌ No results found.' });
            break;
          }
          const durationSec = vResult.duration?.seconds || 0;
          if (durationSec > 480) {
            await sock.sendMessage(sender, { text: `❌ That video is ${vResult.duration.timestamp} long — too long to process (max 8 minutes). Try a shorter one.` });
            break;
          }
          await sock.sendMessage(sender, { image: { url: vResult.thumbnail }, caption: `🎵 ${vResult.title}\n👤 ${vResult.author?.name || 'Unknown'}\n⏱️ ${vResult.duration.timestamp}\n⏳ Downloading...` });
          const vidBase = path.join(os.tmpdir(), `vid_${Date.now()}`);
          try {
            console.log('VIDEO: starting download at', new Date().toISOString());
            await execPromise(`yt-dlp -f "bestvideo[height<=720]+bestaudio/best[height<=720]" -o "${vidBase}.%(ext)s" "${vResult.url}"`, { maxBuffer: 1024*1024*50 });
            const files = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith(path.basename(vidBase)));
            console.log('VIDEO: download finished at', new Date().toISOString());
            const vf = path.join(os.tmpdir(), files[0]);
            const { stdout: vcodec } = await execPromise(`ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "${vf}"`);
            const { stdout: acodec } = await execPromise(`ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of csv=p=0 "${vf}"`);
            const isCompatible = vcodec.trim() === 'h264' && acodec.trim() === 'aac';
            console.log('VIDEO: codec check at', new Date().toISOString(), '- video:', vcodec.trim(), 'audio:', acodec.trim(), '- compatible:', isCompatible);
            let finalFile = vf;
            if (!isCompatible) {
              const outFile = `${vidBase}_h264.mp4`;
              await execPromise(`ffmpeg -i "${vf}" -c:v libx264 -preset veryfast -crf 31 -c:a aac -movflags +faststart "${outFile}"`, { maxBuffer: 1024*1024*50 });
              finalFile = outFile;
              console.log('VIDEO: ffmpeg re-encode finished at', new Date().toISOString());
              console.log('VIDEO: output file size (MB):', (fs.statSync(outFile).size / 1024 / 1024).toFixed(2));
            }
            console.log('VIDEO: upload starting at', new Date().toISOString());
            await sock.sendMessage(sender, { video: fs.readFileSync(finalFile), caption: `✅ ${vResult.title}` });
            await sock.sendMessage(sender, { text: `✅ ${vResult.title} downloaded successfully by JEREMY BOT` });
            console.log('VIDEO: upload finished at', new Date().toISOString());
            fs.unlinkSync(vf);
            if (finalFile !== vf) fs.unlinkSync(finalFile);
          } catch (videoErr) {
            console.log('Video download error:', videoErr);
            await sock.sendMessage(sender, {
              image: { url: vResult.thumbnail },
              caption: `⚠️ Couldn't download video, here's the link instead:\n🔗 ${vResult.url}`
              });
}
break;
}
              case 'tiktok':
case 'tt': {
  const url = args[0];
  if (!url || !url.includes('tiktok.com')) {
    await sock.sendMessage(sender, { text: `Usage: ${PREFIX}tiktok <link>` });
    break;
  }
  await sock.sendMessage(sender, { text: `⏳ Downloading TikTok video...` });
  try {
    const { ttdl } = require('btch-downloader');
    const result = await ttdl(url);
    console.log('TikTok result:', JSON.stringify(result));
    const videoUrl = (Array.isArray(result.video) && result.video.length > 0) ? result.video[0] : (result.video_hd || result.url);
    if (!videoUrl) throw new Error('No video URL in result');
    await sock.sendMessage(sender, { video: { url: videoUrl }, caption: `✅ Here's your TikTok video` });
  } catch (e) {
    console.log('TikTok error:', e);
    await sock.sendMessage(sender, { text: `❌ Couldn't download that video.` });
  }
  break;
}
        case 'fb':
        case 'facebook': {
          const fbUrl = args[0];
          if (!fbUrl || !fbUrl.includes('facebook.com')) {
            await sock.sendMessage(sender, { text: `Usage: ${PREFIX}fb <link>` });
            break;
          }
          await sock.sendMessage(sender, { text: `⏳ Downloading Facebook video...` });
          const fbBase = path.join(os.tmpdir(), `fb_${Date.now()}`);
          try {
            await execPromise(`yt-dlp --impersonate chrome -S "res:720,codec:avc1" -o "${fbBase}.%(ext)s" "${fbUrl}"`, { maxBuffer: 1024*1024*50 });
            const files = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith(path.basename(fbBase)));
            const vf = path.join(os.tmpdir(), files[0]);
            const outFile = `${fbBase}_h264.mp4`;
            await execPromise(`ffmpeg -i "${vf}" -c:v libx264 -preset veryfast -crf 26 -c:a aac -movflags +faststart "${outFile}"`, { maxBuffer: 1024*1024*50 });
            await sock.sendMessage(sender, { video: fs.readFileSync(outFile), caption: '✅ ' + BOT_NAME });
            fs.unlinkSync(vf);
            fs.unlinkSync(outFile);
          } catch (e) {
            console.log('Facebook error:', e);
            await sock.sendMessage(sender, { text: `❌ Couldn't download that video.` });
          }
          break;
        }

        case 'quote': {
          const qres = await fetch('https://zenquotes.io/api/random');
          const qdata = await qres.json();
          const q = qdata[0];
          await sock.sendMessage(sender, { text: `◈━━━━━━━━━━━━━━━━◈\n 💬 *QUOTE*\n◈━━━━━━━━━━━━━━━━◈\n"${q.q}"\n\n— ${q.a}\n◈━━━━━━━━━━━━━━━━◈` });
          break;
        }

        case 'ai': {
          const question = args.join(' ');
          if (!question) {
            await sock.sendMessage(sender, { text: `Usage: ${PREFIX}ai <question>` });
            break;
          }
          try {
            const aiRes = await anthropic.messages.create({
              model: 'claude-sonnet-4-6',
              max_tokens: 1024,
              messages: [{ role: 'user', content: question }]
            });
            const aiText = aiRes.content[0].text;
            await sock.sendMessage(sender, { text: `◈━━━━━━━━━━━━━━━━◈\n 🤖 *AI*\n◈━━━━━━━━━━━━━━━━◈\n${aiText}\n◈━━━━━━━━━━━━━━━━◈` });
          } catch (e) {
            await sock.sendMessage(sender, { text: `AI error: ${e.message}` });
          }
          break;
        }

        case 'gemini': {
          const gquestion = args.join(' ');
          if (!gquestion) {
            await sock.sendMessage(sender, { text: `Usage: ${PREFIX}gemini <question>` });
            break;
          }
          try {
            const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
            const gRes = await model.generateContent(gquestion);
            const gText = gRes.response.text();
            await sock.sendMessage(sender, { text: `◈━━━━━━━━━━━━━━━━◈\n 🤖 *GEMINI*\n◈━━━━━━━━━━━━━━━━◈\n${gText}\n◈━━━━━━━━━━━━━━━━◈` });
          } catch (e) {
            await sock.sendMessage(sender, { text: `Gemini error: ${e.message}` });
          }
          break;
        }

        case 'define': {
          const word = args.join(' ');
          if (!word) {
            await sock.sendMessage(sender, { text: `Usage: ${PREFIX}define <word>` });
            break;
          }
          try {
            const dres = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
            const ddata = await dres.json();
            const meaning = ddata[0].meanings[0];
            const def = meaning.definitions[0].definition;
            await sock.sendMessage(sender, { text: `◈━━━━━━━━━━━━━━━━◈\n 📖 *${word.toUpperCase()}*\n◈━━━━━━━━━━━━━━━━◈\n(${meaning.partOfSpeech}) ${def}\n◈━━━━━━━━━━━━━━━━◈` });
          } catch {
            await sock.sendMessage(sender, { text: `❌ No definition found for "${word}".` });
          }
          break;
        }

        case 'lyrics': {
          const songQuery = args.join(' ');
          if (!songQuery) {
            await sock.sendMessage(sender, { text: `Usage: ${PREFIX}lyrics <song name>` });
            break;
          }
          try {
            const cheerio = require('cheerio');
            const sres = await fetch(`https://api.genius.com/search?q=${encodeURIComponent(songQuery)}`, {
              headers: { Authorization: `Bearer ${GENIUS_TOKEN}` }
            });
            const sdata = await sres.json();
            const hit = sdata.response.hits[0];
            if (!hit) throw new Error('not found');
            const songUrl = hit.result.url;
            const songTitle = hit.result.full_title;
            const pageRes = await fetch(songUrl);
            const pageHtml = await pageRes.text();
            const $ = cheerio.load(pageHtml);
            let lyrics = '';
            $('[data-lyrics-container="true"]').each((i, el) => {
              lyrics += $(el).text() + '\n';
            });
            if (!lyrics.trim()) throw new Error('empty lyrics');
            const trimmed = lyrics.length > 3500 ? lyrics.slice(0, 3500) + '\n...(trimmed)' : lyrics;
            await sock.sendMessage(sender, { text: `◈━━━━━━━━━━━━━━━━◈\n 🎤 *${songTitle}*\n◈━━━━━━━━━━━━━━━━◈\n${trimmed}\n◈━━━━━━━━━━━━━━━━◈` });
          } catch (e) {
            console.log('Lyrics error:', e);
            await sock.sendMessage(sender, { text: `❌ Lyrics not found for "${songQuery}".` });
          }
          break;
        }

        case 'qr': {
          const qrText = args.join(' ');
          if (!qrText) {
            await sock.sendMessage(sender, { text: `Usage: ${PREFIX}qr <text or link>` });
            break;
          }
          try {
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qrText)}`;
            const qrRes = await fetch(qrUrl);
            const qrBuffer = Buffer.from(await qrRes.arrayBuffer());
            await sock.sendMessage(sender, { image: qrBuffer, caption: `✅ QR code for: ${qrText}` });
          } catch (e) {
            console.log('QR error:', e);
            await sock.sendMessage(sender, { text: `❌ Couldn't generate QR code.` });
          }
          break;
        }

        case 'sticker': {
          const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
          const imgMsg = quoted?.imageMessage || msg.message.imageMessage;
          const vidMsg = quoted?.videoMessage || msg.message.videoMessage;
          if (!imgMsg && !vidMsg) {
            await sock.sendMessage(sender, { text: `Reply to an image or short video with ${PREFIX}sticker` });
            break;
          }
          try {
            const mediaMsg = imgMsg || vidMsg;
            const mediaType = imgMsg ? 'image' : 'video';
            const stream = await downloadContentFromMessage(mediaMsg, mediaType);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
              buffer = Buffer.concat([buffer, chunk]);
            }
            const inPath = path.join(os.tmpdir(), `stk_in_${Date.now()}.${mediaType === 'image' ? 'jpg' : 'mp4'}`);
            const outPath = path.join(os.tmpdir(), `stk_out_${Date.now()}.webp`);
            fs.writeFileSync(inPath, buffer);
            const stickerCmd = mediaType === 'image'
              ? `ffmpeg -i "${inPath}" -vf "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=white@0" "${outPath}"`
              : `ffmpeg -i "${inPath}" -vf "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=white@0,fps=15" -t 6 -c:v libwebp -loop 0 -preset default -an -vsync 0 "${outPath}"`;
            await execPromise(stickerCmd);
            await sock.sendMessage(sender, { sticker: fs.readFileSync(outPath) });
            fs.unlinkSync(inPath);
            fs.unlinkSync(outPath);
          } catch (e) {
            console.log('Sticker error:', e);
            await sock.sendMessage(sender, { text: `❌ Couldn't create sticker.` });
          }
          break;
        }

        case 'toimg': {
          const quotedSticker = msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.stickerMessage;
          const directSticker = msg.message.stickerMessage;
          const stickerMsg = quotedSticker || directSticker;
          if (!stickerMsg) {
            await sock.sendMessage(sender, { text: `Reply to a sticker with ${PREFIX}toimg` });
            break;
          }
          try {
            const stream = await downloadContentFromMessage(stickerMsg, 'sticker');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
              buffer = Buffer.concat([buffer, chunk]);
            }
            const inPath = path.join(os.tmpdir(), `toimg_in_${Date.now()}.webp`);
            const outPath = path.join(os.tmpdir(), `toimg_out_${Date.now()}.png`);
            fs.writeFileSync(inPath, buffer);
            await execPromise(`ffmpeg -i "${inPath}" "${outPath}"`);
            await sock.sendMessage(sender, { image: fs.readFileSync(outPath) });
            fs.unlinkSync(inPath);
            fs.unlinkSync(outPath);
          } catch (e) {
            console.log('Toimg error:', e);
            await sock.sendMessage(sender, { text: `❌ Couldn't convert sticker to image.` });
          }
          break;
        }

        case 'motivate':
        case 'motivation': {
          const mres = await fetch('https://zenquotes.io/api/random');
          const mdata = await mres.json();
          const m = mdata[0];
          await sock.sendMessage(sender, { text: `◈━━━━━━━━━━━━━━━━◈\n 🔥 *MOTIVATION*\n◈━━━━━━━━━━━━━━━━◈\n"${m.q}"\n\n— ${m.a}\n◈━━━━━━━━━━━━━━━━◈` });
          break;
        }

        case 'bible': {
          try {
            const bref = args.join(' ');
            const bUrl = bref ? `https://bible-api.com/${encodeURIComponent(bref)}` : 'https://bible-api.com/data/web/random';
            const bres = await fetch(bUrl);
            const bdata = await bres.json();
            const verseText = bdata.text || bdata.random_verse?.text || 'Verse not found.';
            const ref = bdata.reference || (bdata.random_verse ? `${bdata.random_verse.book} ${bdata.random_verse.chapter}:${bdata.random_verse.verse}` : '');
            await sock.sendMessage(sender, { text: `◈━━━━━━━━━━━━━━━━◈\n ✝️ *BIBLE${ref ? ' - ' + ref : ''}*\n◈━━━━━━━━━━━━━━━━◈\n${verseText.trim()}\n◈━━━━━━━━━━━━━━━━◈` });
          } catch (e) {
            console.log('Bible error:', e);
            await sock.sendMessage(sender, { text: `❌ Couldn't fetch verse. Try: ${PREFIX}bible John 3:16` });
          }
          break;
        }

        case 'pp': {
          try {
            let target = msg.message.extendedTextMessage?.contextInfo?.participant;
            const altTarget = msg.message.extendedTextMessage?.contextInfo?.participantAlt || msg.message.extendedTextMessage?.contextInfo?.participantPn;
            if (!target && args[0]) target = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
            if (!target) target = sender;
            console.log('PP target JID:', target);
            let ppUrl;
            try {
              ppUrl = await sock.profilePictureUrl(target, 'image');
            } catch {
              if (altTarget) ppUrl = await sock.profilePictureUrl(altTarget, 'image');
            }
            if (!ppUrl) { await sock.sendMessage(sender, { text: '❌ No profile picture found.' }); break; }
            await sock.sendMessage(sender, { image: { url: ppUrl }, caption: `✅ Profile picture` });
          } catch (e) {
            console.log('PP error:', e);
            await sock.sendMessage(sender, { text: `❌ Couldn't fetch profile picture (may be private or not set).` });
          }
          break;
        }

        case 'wyr': {
          try {
            const wres = await fetch('https://api.truthordarebot.xyz/v1/wyr');
            const wdata = await wres.json();
            await sock.sendMessage(sender, { text: `◈━━━━━━━━━━━━━━━━◈\n 🤔 *WOULD YOU RATHER*\n◈━━━━━━━━━━━━━━━━◈\n${wdata.question}\n◈━━━━━━━━━━━━━━━━◈` });
          } catch (e) {
            console.log('WYR error:', e);
            await sock.sendMessage(sender, { text: `❌ Couldn't fetch a question, try again.` });
          }
          break;
        }

        case 'weather': {
          if (args.length === 0) {
            await sock.sendMessage(sender, { text: `Usage: ${PREFIX}weather <city name>` });
            break;
          }
          const city = args.join(' ');
          const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=3`);
          const data = await res.text();
          await sock.sendMessage(sender, { text: `◈━━━━━━━━━━━━━━━━◈\n 🌤️ *WEATHER*\n◈━━━━━━━━━━━━━━━━◈\n ${data}\n◈━━━━━━━━━━━━━━━━◈` });
          break;
        }

        case 'alwaysonline': {
          const val = args[0]?.toLowerCase();
          if (val !== 'on' && val !== 'off') {
            await sock.sendMessage(sender, { text: `Usage: ${PREFIX}alwaysonline on/off` });
            break;
          }
          settings.alwaysonline = val === 'on';
          await sock.sendMessage(sender, { text: `◈━━━━━━━━━━━━━━━━◈\n 🟢 *ALWAYS ONLINE* » ${settings.alwaysonline ? 'ON ✅' : 'OFF ❌'}\n◈━━━━━━━━━━━━━━━━◈` });
          break;
        }

        case 'aiauto': {
          const val = args[0]?.toLowerCase();
          if (val !== 'on' && val !== 'off') {
            await sock.sendMessage(sender, { text: `Usage: ${PREFIX}aiauto on/off` });
            break;
          }
          settings.aiAuto = val === 'on';
          await sock.sendMessage(sender, { text: `◈━━━━━━━━━━━━━━━━◈\n 🤖 *AI AUTO-REPLY* » ${settings.aiAuto ? 'ON ✅' : 'OFF ❌'}\n◈━━━━━━━━━━━━━━━━◈` });
          break;
        }

        case 'autotype': {
          const val = args[0]?.toLowerCase();
          if (val !== 'on' && val !== 'off') {
            await sock.sendMessage(sender, { text: `Usage: ${PREFIX}autotype on/off` });
            break;
          }
          settings.autotype = val === 'on';
          await sock.sendMessage(sender, { text: `◈━━━━━━━━━━━━━━━━◈\n ✍️ *AUTO TYPE* » ${settings.autotype ? 'ON ✅' : 'OFF ❌'}\n◈━━━━━━━━━━━━━━━━◈` });
          break;
        }

        case 'autorecord': {
          const val = args[0]?.toLowerCase();
          if (val !== 'on' && val !== 'off') {
            await sock.sendMessage(sender, { text: `Usage: ${PREFIX}autorecord on/off` });
            break;
          }
          settings.autorecord = val === 'on';
          await sock.sendMessage(sender, { text: `◈━━━━━━━━━━━━━━━━◈\n 🎙️ *AUTO RECORD* » ${settings.autorecord ? 'ON ✅' : 'OFF ❌'}\n◈━━━━━━━━━━━━━━━━◈` });
          break;
        }

        case 'autoviewstatus': {
          const val = args[0]?.toLowerCase();
          if (val !== 'on' && val !== 'off') {
            await sock.sendMessage(sender, { text: `Usage: ${PREFIX}autoviewstatus on/off` });
            break;
          }
          settings.autoviewstatus = val === 'on';
          await sock.sendMessage(sender, { text: `◈━━━━━━━━━━━━━━━━◈\n 👁️ *AUTO VIEW STATUS* » ${settings.autoviewstatus ? 'ON ✅' : 'OFF ❌'}\n◈━━━━━━━━━━━━━━━━◈` });
          break;
        }

        case 'autostatusreact': {
          const val = args[0]?.toLowerCase();
          if (val !== 'on' && val !== 'off') {
            await sock.sendMessage(sender, { text: `Usage: ${PREFIX}autostatusreact on/off` });
            break;
          }
          settings.autostatusreact = val === 'on';
          await sock.sendMessage(sender, { text: `◈━━━━━━━━━━━━━━━━◈\n ❤️ *AUTO STATUS REACT* » ${settings.autostatusreact ? 'ON ✅' : 'OFF ❌'}\n◈━━━━━━━━━━━━━━━━◈` });
          break;
        }

        case 'autoreact': {
          const val = args[0]?.toLowerCase();
          if (val !== 'on' && val !== 'off') {
            await sock.sendMessage(sender, { text: `Usage: ${PREFIX}autoreact on/off` });
            break;
          }
          settings.autoreact = val === 'on';
          await sock.sendMessage(sender, { text: `◈━━━━━━━━━━━━━━━━◈\n 🔥 *AUTO REACT* » ${settings.autoreact ? 'ON ✅' : 'OFF ❌'}\n◈━━━━━━━━━━━━━━━━◈` });
          break;
        }

        case 'anticall': {
          const val = args[0]?.toLowerCase();
          if (val !== 'on' && val !== 'off') {
            await sock.sendMessage(sender, { text: `Usage: ${PREFIX}anticall on/off` });
            break;
          }
          settings.anticall = val === 'on';
          await sock.sendMessage(sender, { text: `◈━━━━━━━━━━━━━━━━◈\n 📵 *ANTI-CALL* » ${settings.anticall ? 'ON ✅' : 'OFF ❌'}\n◈━━━━━━━━━━━━━━━━◈` });
          break;
        }

        case 'anticallmsg': {
          const newMsg = args.join(' ');
          if (!newMsg) {
            await sock.sendMessage(sender, { text: `Usage: ${PREFIX}anticallmsg <your message>\nCurrent: ${settings.anticallMessage}` });
            break;
          }
          settings.anticallMessage = newMsg;
          await sock.sendMessage(sender, { text: `◈━━━━━━━━━━━━━━━━◈\n 📵 *ANTI-CALL MESSAGE UPDATED*\n◈━━━━━━━━━━━━━━━━◈\n${newMsg}\n◈━━━━━━━━━━━━━━━━◈` });
          break;
        }

        case 'antilink': {
          const val = args[0]?.toLowerCase();
          if (val !== 'on' && val !== 'off') {
            await sock.sendMessage(sender, { text: `Usage: ${PREFIX}antilink on/off (for groups)` });
            break;
          }
          settings.antilinkGroup = val === 'on';
          await sock.sendMessage(sender, { text: `◈━━━━━━━━━━━━━━━━◈\n 🔗 *ANTI-LINK (GROUP)* » ${settings.antilinkGroup ? 'ON ✅' : 'OFF ❌'}\n◈━━━━━━━━━━━━━━━━◈` });
          break;
        }

        case 'antilinkdm': {
          const val = args[0]?.toLowerCase();
          if (val !== 'on' && val !== 'off') {
            await sock.sendMessage(sender, { text: `Usage: ${PREFIX}antilinkdm on/off (for private chats)` });
            break;
          }
          settings.antilinkPrivate = val === 'on';
          await sock.sendMessage(sender, { text: `◈━━━━━━━━━━━━━━━━◈\n 🔗 *ANTI-LINK (DM)* » ${settings.antilinkPrivate ? 'ON ✅' : 'OFF ❌'}\n◈━━━━━━━━━━━━━━━━◈` });
          break;
        }

        case 'antidelete': {
          const val = args[0]?.toLowerCase();
          if (val !== 'on' && val !== 'off') {
            await sock.sendMessage(sender, { text: `Usage: ${PREFIX}antidelete on/off` });
            break;
          }
          settings.antidelete = val === 'on';
          await sock.sendMessage(sender, { text: `◈━━━━━━━━━━━━━━━━◈\n 🗑️ *ANTI-DELETE* » ${settings.antidelete ? 'ON ✅' : 'OFF ❌'}\n◈━━━━━━━━━━━━━━━━◈` });
          break;
        }

        case 'antispam': {
          const val = args[0]?.toLowerCase();
          if (val !== 'on' && val !== 'off') {
            await sock.sendMessage(sender, { text: `Usage: ${PREFIX}antispam on/off` });
            break;
          }
          settings.antispam = val === 'on';
          await sock.sendMessage(sender, { text: `◈━━━━━━━━━━━━━━━━◈\n 🚨 *ANTI-SPAM* » ${settings.antispam ? 'ON ✅' : 'OFF ❌'}\n◈━━━━━━━━━━━━━━━━◈` });
          break;
        }

        case 'antimention': {
          const val = args[0]?.toLowerCase();
          if (val !== 'on' && val !== 'off') {
            await sock.sendMessage(sender, { text: `Usage: ${PREFIX}antimention on/off` });
            break;
          }
          settings.antimention = val === 'on';
          await sock.sendMessage(sender, { text: `◈━━━━━━━━━━━━━━━━◈\n 🔕 *ANTI-MENTION* » ${settings.antimention ? 'ON ✅' : 'OFF ❌'}\n◈━━━━━━━━━━━━━━━━◈` });
          break;
        }

        case 'setfooter': {
          const newFooter = args.join(' ');
          if (!newFooter) {
            await sock.sendMessage(sender, { text: `Usage: ${PREFIX}setfooter <text>\nCurrent: ${settings.footerText}` });
            break;
          }
          settings.footerText = newFooter;
          await sock.sendMessage(sender, { text: `◈━━━━━━━━━━━━━━━━◈\n ✅ *FOOTER UPDATED*\n◈━━━━━━━━━━━━━━━━◈\n${newFooter}\n◈━━━━━━━━━━━━━━━━◈` });
          break;
        }

        case 'welcome': {
          const val = args[0]?.toLowerCase();
          if (val !== 'on' && val !== 'off') {
            await sock.sendMessage(sender, { text: `Usage: ${PREFIX}welcome on/off` });
            break;
          }
          settings.welcomeEnabled = val === 'on';
          await sock.sendMessage(sender, { text: `◈━━━━━━━━━━━━━━━━◈\n 👋 *WELCOME MESSAGES* » ${settings.welcomeEnabled ? 'ON ✅' : 'OFF ❌'}\n◈━━━━━━━━━━━━━━━━◈` });
          break;
        }

        case 'setwelcome': {
          if (!isGroup) {
            await sock.sendMessage(sender, { text: '❌ This command only works in groups.' });
            break;
          }
          const newWelcome = args.join(' ');
          if (!newWelcome) {
            await sock.sendMessage(sender, { text: `Usage: ${PREFIX}setwelcome <text>\nUse {user} where you want to mention the new member.\nExample: ${PREFIX}setwelcome Welcome {user}, enjoy your stay!` });
            break;
          }
          groupWelcomes.set(sender, newWelcome);
          await sock.sendMessage(sender, { text: `◈━━━━━━━━━━━━━━━━◈\n ✅ *WELCOME MESSAGE SET*\n◈━━━━━━━━━━━━━━━━◈\n${newWelcome}\n◈━━━━━━━━━━━━━━━━◈` });
          break;
        }


        case 'mode': {
          const val = args[0]?.toLowerCase();
          if (val !== 'public' && val !== 'private') {
            await sock.sendMessage(sender, { text: `Usage: ${PREFIX}mode public/private\nCurrent: ${settings.botMode}` });
            break;
          }
          settings.botMode = val;
          await sock.sendMessage(sender, { text: `◈━━━━━━━━━━━━━━━━◈\n 🔒 *BOT MODE* » ${settings.botMode.toUpperCase()}\n◈━━━━━━━━━━━━━━━━◈` });
          break;
        }

        case 'setprefix': {
          const newPrefix = args[0];
          if (!newPrefix || newPrefix.length > 3) {
            await sock.sendMessage(sender, { text: `Usage: ${PREFIX}setprefix <symbol>\nExample: ${PREFIX}setprefix !\nCurrent: ${PREFIX}` });
            break;
          }
          PREFIX = newPrefix;
          await sock.sendMessage(sender, { text: `◈━━━━━━━━━━━━━━━━◈\n 🔑 *PREFIX CHANGED* » [ ${PREFIX} ]\n◈━━━━━━━━━━━━━━━━◈` });
          break;
        }


        case 'statusemoji': {
          if (!args[0]) {
            await sock.sendMessage(sender, { text: `Usage: ${PREFIX}statusemoji <emoji>\nCurrent: ${settings.statusemoji}` });
            break;
          }
          settings.statusemoji = args[0];
          await sock.sendMessage(sender, { text: `◈━━━━━━━━━━━━━━━━◈\n 😊 *STATUS EMOJI* set to » ${settings.statusemoji}\n◈━━━━━━━━━━━━━━━━◈` });
          break;
        }

        case 'settings': {
          await sock.sendMessage(sender, { text:
`◈━━━━━━━━━━━━━━━━◈
  ⚙️ *BOT SETTINGS*
◈━━━━━━━━━━━━━━━━◈
 🟢 Always Online    » ${settings.alwaysonline ? 'ON ✅' : 'OFF ❌'}
 ✍️ Auto Type        » ${settings.autotype ? 'ON ✅' : 'OFF ❌'}
 🎙️ Auto Record      » ${settings.autorecord ? 'ON ✅' : 'OFF ❌'}
 👁️ Auto View Status » ${settings.autoviewstatus ? 'ON ✅' : 'OFF ❌'}
 ❤️ Auto Status React » ${settings.autostatusreact ? 'ON ✅' : 'OFF ❌'}
 🔥 Auto React       » ${settings.autoreact ? 'ON ✅' : 'OFF ❌'}
 😊 Status Emoji     » ${settings.statusemoji}
◈━━━━━━━━━━━━━━━━◈` });
          break;
        }
        case 'pair': {
          if (!args[0]) {
            await sock.sendMessage(sender, { text: `Usage: ${PREFIX}pair <number with country code>\nExample: ${PREFIX}pair 237612345678` });
            break;
          }
          const newNumber = args[0].replace(/[^0-9]/g, '');
          const newAuthFolder = `auth_info_${newNumber}`;
          const sessions = loadSessions();
          if (sessions[newNumber]) {
            await sock.sendMessage(sender, { text: `⚠️ ${newNumber} is already paired or pairing.` });
            break;
          }
          sessions[newNumber] = { number: newNumber, authFolder: newAuthFolder, status: 'pairing', pairedAt: Date.now() };
          saveSessions(sessions);
          await sock.sendMessage(sender, { text: `⏳ Generating pairing code for +${newNumber}...` });
          startBot(newAuthFolder, newNumber, async (code) => {
            await sock.sendMessage(sender, { text:
`◈━━━━━━━━━━━━━━━━◈
🔗 *PAIRING CODE*
◈━━━━━━━━━━━━━━━━◈
📱 Number » +${newNumber}
🔑 Code   » *${code}*
◈━━━━━━━━━━━━━━━━◈
Enter this code in WhatsApp
Linked Devices → Link with
phone number instead` });
          });
          break;
        }



        case 'session': {
          const allSessions = loadSessions();
          const nums = Object.keys(allSessions);
          if (nums.length === 0) {
            await sock.sendMessage(sender, { text: `◈━━━━━━━━━━━━━━━━◈\n 📋 *ACTIVE SESSIONS*\n◈━━━━━━━━━━━━━━━━◈\nNo paired users yet.\n◈━━━━━━━━━━━━━━━━◈` });
            break;
          }
          let list = '';
          for (const num of nums) {
            const s = allSessions[num];
            list += `📱 +${s.number} — ${s.status === 'connected' ? 'ON ✅' : 'PAIRING ⏳'}\n`;
          }
          await sock.sendMessage(sender, { text: `◈━━━━━━━━━━━━━━━━◈\n 📋 *ACTIVE SESSIONS*\n◈━━━━━━━━━━━━━━━━◈\n${list}◈━━━━━━━━━━━━━━━━◈` });
          break;
        }

        case 'rsession': {
          if (!args[0]) {
            await sock.sendMessage(sender, { text: `Usage: ${PREFIX}rsession <number>` });
            break;
          }
          const rmNumber = args[0].replace(/[^0-9]/g, '');
          const rsSessions = loadSessions();
          if (!rsSessions[rmNumber]) {
            await sock.sendMessage(sender, { text: `⚠️ No session found for +${rmNumber}.` });
            break;
          }
          const rmFolder = rsSessions[rmNumber].authFolder;
          delete rsSessions[rmNumber];
          saveSessions(rsSessions);
          try { fs.rmSync(rmFolder, { recursive: true, force: true }); } catch {}
          await sock.sendMessage(sender, { text: `✅ Session for +${rmNumber} removed. They'll need to be re-paired to use the bot again.\n\n⚠️ Restart the bot (./start.sh) for the disconnect to fully take effect.` });
          break;
        }

        case 'ban': {
          let target = msg.message.extendedTextMessage?.contextInfo?.participant;
          if (!target && args[0]) target = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
          if (!target) {
            await sock.sendMessage(sender, { text: `Reply to a message or use ${PREFIX}ban <number>` });
            break;
          }
          await sock.updateBlockStatus(target, 'block');
          await sock.sendMessage(sender, { text: `◈━━━━━━━━━━━━━━━━◈\n 🚫 Contact has been *BLOCKED*\n◈━━━━━━━━━━━━━━━━◈` });
          break;
        }

        case 'unban': {
          let target = msg.message.extendedTextMessage?.contextInfo?.participant;
          if (!target && args[0]) target = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
          if (!target) {
            await sock.sendMessage(sender, { text: `Reply to a message or use ${PREFIX}unban <number>` });
            break;
          }
          await sock.updateBlockStatus(target, 'unblock');
          await sock.sendMessage(sender, { text: `◈━━━━━━━━━━━━━━━━◈\n ✅ Contact has been *UNBLOCKED*\n◈━━━━━━━━━━━━━━━━◈` });
          break;
        }

        case 'kick':
        case 'promote':
        case 'demote': {
          if (!isGroup) {
            await sock.sendMessage(sender, { text: '❌ This command only works in groups.' });
            break;
          }
          const target = msg.message.extendedTextMessage?.contextInfo?.participant;
          if (!target) {
            await sock.sendMessage(sender, { text: `Reply to the member's message with ${PREFIX}${command}` });
            break;
          }
          const action = command === 'kick' ? 'remove' : command;
          await sock.groupParticipantsUpdate(sender, [target], action);
          await sock.sendMessage(sender, { text: `◈━━━━━━━━━━━━━━━━◈\n ✅ *${command.toUpperCase()}* done\n◈━━━━━━━━━━━━━━━━◈` });
          break;
        }

        case 'tagall': {
          if (!isGroup) {
            await sock.sendMessage(sender, { text: '❌ This command only works in groups.' });
            break;
          }
          const groupMetadata = await sock.groupMetadata(sender);
          const participants = groupMetadata.participants.map(p => p.id);
          const mentionText = participants.map(p => `@${p.split('@')[0]}`).join(' ');
          await sock.sendMessage(sender, { text: mentionText, mentions: participants });
          break;
        }

        default:
          break;
      }
    } catch (err) {
      console.log('Command error:', err);
      await sock.sendMessage(sender, { text: '❌ Something went wrong.' });
    }
  });
}

if (require.main === module) {
  startBot();

  const savedSessions = loadSessions();
  for (const num in savedSessions) {
    const s = savedSessions[num];
    if (s.status !== 'connected') { console.log('Skipping inactive session:', num); continue; }
    console.log('Reconnecting saved session:', num);
    startBot(s.authFolder, s.number);
  }
}

module.exports = { startBot };
