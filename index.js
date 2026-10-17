const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const config = require('./config');
const purincash = require('./services/purincash');

const DB_PATH = path.join(__dirname, 'database.json');
const FIXED_OWNER_NUMBER = '5562982520428';

const ownerInteractiveSessions = new Map();
const spamTracker = new Map();
const tictactoeGames = new Map();

const ORES = {
  carvao: { id: "carvao", name: "Carvão", rarity: 0.40, basePrice: 2, icon: "⬛" },
  cobre: { id: "cobre", name: "Cobre", rarity: 0.25, basePrice: 5, icon: "🥉" },
  ferro: { id: "ferro", name: "Ferro", rarity: 0.15, basePrice: 12, icon: "⚙️" },
  ouro: { id: "ouro", name: "Ouro", rarity: 0.10, basePrice: 30, icon: "🪙" },
  diamante: { id: "diamante", name: "Diamante", rarity: 0.06, basePrice: 80, icon: "💎" },
  esmeralda: { id: "esmeralda", name: "Esmeralda", rarity: 0.03, basePrice: 150, icon: "🟢" },
  netunerita: { id: "netunerita", name: "Netunerita", rarity: 0.009, basePrice: 350, icon: "🌌" },
  pedra_filosofal: { id: "pedra_filosofal", name: "Pedra Filosofal", rarity: 0.001, basePrice: 1000, icon: "🔮" }
};

const DEFAULT_PRODUCTS = {
  "trocar_profissao": { id: "trocar_profissao", name: "Trocar de Profissão", desc: "Muda sua profissão para uma nova aleatória com salários melhores ou piores!", price: 150 },
  "picareta_madeira": { id: "picareta_madeira", name: "Picareta de Madeira", desc: "Aumenta seus minérios em 2x o valor encontrado e dá +1 minério extra.", price: 300, multiplier: 2, extraOres: 1, rareBoost: 1.0 },
  "picareta_pedra": { id: "picareta_pedra", name: "Picareta de Pedra", desc: "Multiplica o valor em 3x e dá +2 minérios extras.", price: 800, multiplier: 3, extraOres: 2, rareBoost: 1.2 },
  "picareta_ferro": { id: "picareta_ferro", name: "Picareta de Ferro", desc: "Multiplica o valor em 4x e aumenta a chance de minérios raros.", price: 2000, multiplier: 4, extraOres: 3, rareBoost: 1.5 },
  "picareta_diamante": { id: "picareta_diamante", name: "Picareta de Diamante", desc: "Multiplica o valor em 6x e dá minérios altamente valiosos.", price: 5000, multiplier: 6, extraOres: 4, rareBoost: 2.0 },
  "picareta_aco": { id: "picareta_aco", name: "Picareta de Aço", desc: "Multiplica em 8x o valor dos minérios e concede +5 minérios por expedição.", price: 12000, multiplier: 8, extraOres: 5, rareBoost: 3.0 },
  "picareta_titanium": { id: "picareta_titanium", name: "Picareta de Titanium", desc: "Multiplica em 10x o valor e garante alta presença de Netunerita e Diamantes.", price: 25000, multiplier: 10, extraOres: 6, rareBoost: 4.5 },
  "picareta_dos_deuses": { id: "picareta_dos_deuses", name: "Picareta dos Deuses", desc: "A mais OP! Multiplica por 11x, garante apenas minérios raros e permite minerar 2x seguidas!", price: 60000, multiplier: 11, extraOres: 8, rareBoost: 8.0, doubleMine: true }
};

function loadDatabase() {
  if (!fs.existsSync(DB_PATH)) {
    const defaultData = {
      ownerJid: null, ownerName: "MONTANHA DEV", ownerNumber: FIXED_OWNER_NUMBER,
      rentedGroups: {}, blacklistedUsers: [], customCommands: {}, groupSettings: {},
      partners: {}, groupSchedules: {}, mutedUsers: {}, wallets: {}, groupRequests: {},
      suggestions: {}, userProfessions: {}, userPickaxes: {}, userOres: {}, cooldowns: {},
      shopProducts: DEFAULT_PRODUCTS,
      gameConfigs: { minSalary: 50, workCooldownHours: 24, robCooldownHours: 12, mineCooldownHours: 6 },
      diceWinStreak: {}, suggestionCounter: 1, requestCounter: 1,
      rentalPlans: {
        "1_dia": { name: "1 Dia de Aluguel", days: 1, price: 2.00 },
        "7_dias": { name: "7 Dias de Aluguel", days: 7, price: 10.00 },
        "30_dias": { name: "30 Dias de Aluguel", days: 30, price: 30.00 }
      }
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(defaultData, null, 2));
    return defaultData;
  }
  try {
    const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    data.ownerNumber = FIXED_OWNER_NUMBER;
    if (!data.rentedGroups) data.rentedGroups = {};
    if (!data.blacklistedUsers) data.blacklistedUsers = [];
    if (!data.customCommands) data.customCommands = {};
    if (!data.groupSettings) data.groupSettings = {};
    if (!data.partners) data.partners = {};
    if (!data.groupSchedules) data.groupSchedules = {};
    if (!data.mutedUsers) data.mutedUsers = {};
    if (!data.wallets) data.wallets = {};
    if (!data.groupRequests) data.groupRequests = {};
    if (!data.suggestions) data.suggestions = {};
    if (!data.userProfessions) data.userProfessions = {};
    if (!data.userPickaxes) data.userPickaxes = {};
    if (!data.userOres) data.userOres = {};
    if (!data.cooldowns) data.cooldowns = {};
    if (!data.shopProducts) data.shopProducts = DEFAULT_PRODUCTS;
    if (!data.gameConfigs) data.gameConfigs = { minSalary: 50, workCooldownHours: 24, robCooldownHours: 12, mineCooldownHours: 6 };
    if (!data.diceWinStreak) data.diceWinStreak = {};
    if (data.suggestionCounter === undefined) data.suggestionCounter = 1;
    if (data.requestCounter === undefined) data.requestCounter = 1;
    if (!data.rentalPlans) data.rentalPlans = {
      "1_dia": { name: "1 Dia de Aluguel", days: 1, price: 2.00 },
      "7_dias": { name: "7 Dias de Aluguel", days: 7, price: 10.00 },
      "30_dias": { name: "30 Dias de Aluguel", days: 30, price: 30.00 }
    };
    return data;
  } catch {
    return { ownerJid: null, ownerName: "MONTANHA DEV", ownerNumber: FIXED_OWNER_NUMBER, rentedGroups: {}, blacklistedUsers: [], customCommands: {}, groupSettings: {}, partners: {}, groupSchedules: {}, mutedUsers: {}, wallets: {}, groupRequests: {}, suggestions: {}, userProfessions: {}, userPickaxes: {}, userOres: {}, cooldowns: {}, shopProducts: DEFAULT_PRODUCTS, gameConfigs: { minSalary: 50, workCooldownHours: 24, robCooldownHours: 12, mineCooldownHours: 6 }, diceWinStreak: {}, suggestionCounter: 1, requestCounter: 1, rentalPlans: {} };
  }
}

function saveDatabase(data) {
  data.ownerNumber = FIXED_OWNER_NUMBER;
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function getBalance(db, userJid) {
  if (db.wallets[userJid] === undefined) {
    db.wallets[userJid] = 10;
    saveDatabase(db);
  }
  return db.wallets[userJid];
}

function updateBalance(db, userJid, amount) {
  const current = getBalance(db, userJid);
  db.wallets[userJid] = Math.max(0, current + amount);
  saveDatabase(db);
  return db.wallets[userJid];
}

function isGroupRented(rentedGroups, groupJid) {
  const group = rentedGroups[groupJid];
  if (!group || !group.expireAt) return false;
  return Date.now() < group.expireAt;
}

async function safeSendMessage(sock, jid, content, options = {}) {
  try {
    return await sock.sendMessage(jid, content, options);
  } catch (err) {
    console.log(`⚠️ Não foi possível enviar mensagem em ${jid}:${err.message}`);
    return null;
  }
}

async function generateQrBuffer(text) {
  if (!text || typeof text !== 'string') return null;
  try {
    return await QRCode.toBuffer(text, { type: 'png', margin: 2, scale: 8 });
  } catch (e) {
    return null;
  }
}

function extractPixString(chargeObj) {
  if (!chargeObj) return null;
  if (typeof chargeObj === 'string') return chargeObj;
  return chargeObj.pix?.brCode || chargeObj.pix?.code || chargeObj.brCode || chargeObj.pixCopiaECola || chargeObj.code || chargeObj.pixCode || chargeObj.qrcode || chargeObj.payload || null;
}

function extractInviteCode(text) {
  const match = text.match(/(?:https?:\/\/)?(?:chat\.whatsapp\.com\/)?([0-9A-Za-z]{20,24})/i);
  return match ? match[1] : null;
}

const PROFESSIONS = [
  { name: "Freelancer Dev", multiplier: 1.0 },
  { name: "Ajudante de Limpeza", multiplier: 0.8 },
  { name: "Bater Laje", multiplier: 1.2 },
  { name: "Pedreiro", multiplier: 1.3 },
  { name: "Descarregar Caminhão", multiplier: 1.1 },
  { name: "Atendente de Fast Food", multiplier: 0.9 },
  { name: "Entregador de App", multiplier: 1.0 },
  { name: "Motorista de Uber", multiplier: 1.15 },
  { name: "Segurança Noturno", multiplier: 1.25 },
  { name: "Eletricista", multiplier: 1.4 }
];

function getRandomProfession() {
  return PROFESSIONS[Math.floor(Math.random() * PROFESSIONS.length)];
}

function getRandomOre(rareBoost = 1.0) {
  const oreKeys = Object.keys(ORES);
  let totalWeight = 0;
  const weights = {};
  for (const k of oreKeys) {
    let w = ORES[k].rarity;
    if (k !== 'carvao' && k !== 'cobre') w = w * rareBoost;
    weights[k] = w;
    totalWeight += w;
  }
  let rand = Math.random() * totalWeight;
  for (const k of oreKeys) {
    if (rand < weights[k]) return ORES[k];
    rand -= weights[k];
  }
  return ORES.carvao;
}

function initBackgroundTasks(sock) {
  setInterval(() => { try { if (global.gc) global.gc(); } catch (e) {} }, 30 * 60 * 1000);
  setInterval(async () => {
    const db = loadDatabase();
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const timestampNow = Date.now();

    for (const [groupJid, schedule] of Object.entries(db.groupSchedules)) {
      if (!schedule) continue;
      if (currentTime === schedule.open) {
        await sock.groupSettingUpdate(groupJid, 'not_announcement').catch(() => {});
        await safeSendMessage(sock, groupJid, { text: `🔓 *Abertura Automática:* Grupo aberto conforme agendamento (\`${schedule.open}\`).` });
      } else if (currentTime === schedule.close) {
        await sock.groupSettingUpdate(groupJid, 'announcement').catch(() => {});
        await safeSendMessage(sock, groupJid, { text: `🔒 *Fechamento Automático:* Grupo fechado conforme agendamento (\`${schedule.close}\`).` });
      }
    }

    let dbUpdated = false;
    for (const [groupJid, mutes] of Object.entries(db.mutedUsers)) {
      if (!mutes) continue;
      for (const [userJid, data] of Object.entries(mutes)) {
        if (data.expiresAt && timestampNow >= data.expiresAt) {
          delete mutes[userJid];
          dbUpdated = true;
          await safeSendMessage(sock, groupJid, { text: `🔓 O tempo de silenciamento de @${userJid.split('@')[0]} expirou e ele foi desmutado automaticamente!`, mentions: [userJid] });
        }
      }
    }
    if (dbUpdated) saveDatabase(db);
  }, 60000);
}

function parseMuteDuration(durationStr) {
  const match = durationStr.match(/^(\d+)([hd])$/i);
  if (!match) return null;
  const value = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === 'h') return value * 60 * 60 * 1000;
  if (unit === 'd') return value * 24 * 60 * 60 * 1000;
  return null;
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./session');
  const { version } = await fetchLatestBaileysVersion();
  let db = loadDatabase();

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    auth: state,
    browser: ['Mac OS', 'Chrome', '121.0.6167.159'],
    markOnlineOnConnect: true,
    generateHighQualityLinkPreview: true,
    syncFullHistory: false
  });

  if (!sock.authState.creds.registered) {
    setTimeout(async () => {
      try {
        await new Promise(resolve => setTimeout(resolve, 8000));
        const pairingCode = await sock.requestPairingCode(config.DEFAULT_BOT_NUMBER);
        console.log(`\n========================================\n📌 CÓDIGO DE PAREAMENTO: ${pairingCode}\n========================================\n`);
      } catch (err) {}
    }, 5000);
  }

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        setTimeout(() => startBot(), 4000);
      }
    } else if (connection === 'open') {
      initBackgroundTasks(sock);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const from = msg.key.remoteJid;
      const isGroup = from.endsWith('@g.us');
      const senderJid = msg.key.participant || msg.key.remoteJid;
      const userNumber = senderJid.split('@')[0].split(':')[0];
      
      db = loadDatabase();

      if (db.blacklistedUsers.includes(senderJid) || db.blacklistedUsers.includes(userNumber)) continue;
      if (isGroup && db.mutedUsers[from]?.[senderJid]) {
        await sock.sendMessage(from, { delete: msg.key }).catch(() => {});
        continue;
      }

      const text = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || '';
      const trimmedText = text.trim();
      const isOwner = db.ownerJid && (senderJid === db.ownerJid || senderJid.split('@')[0] === db.ownerJid.split('@')[0]);

      if (!isGroup && !trimmedText.startsWith('/')) {
        const inviteCode = extractInviteCode(trimmedText);
        if (inviteCode) {
          const reqId = String(db.requestCounter || 1).padStart(3, '0');
          db.requestCounter = (db.requestCounter || 1) + 1;
          if (!db.groupRequests) db.groupRequests = {};
          db.groupRequests[reqId] = { link: trimmedText, inviteCode: inviteCode, sender: senderJid, timestamp: Date.now() };
          saveDatabase(db);
          if (db.ownerJid) {
            await safeSendMessage(sock, db.ownerJid, { text: `🚨 *NOVA SOLICITAÇÃO*\n🆔 \`${reqId}\`\n👤 @${userNumber}\n🔗 ${trimmedText}\n\nUse \`/aprovargrupo ${reqId}\``, mentions: [senderJid] });
          }
          await safeSendMessage(sock, from, { text: "🌙 Link recebido! O Dono Supremo foi notificado." }, { quoted: msg });
          continue;
        }
      }

      const command = trimmedText.split(' ')[0].toLowerCase();
      const args = trimmedText.split(' ').slice(1);

      if (!trimmedText.startsWith('/')) continue;
      const commandNotFoundMsg = "❌ Comando não encontrado! Digite /menu para ver a lista.";

      if (command === '/mtn') {
        db.ownerJid = senderJid;
        db.ownerNumber = FIXED_OWNER_NUMBER;
        db.ownerName = "MONTANHA DEV";
        saveDatabase(db);
        await safeSendMessage(sock, from, { text: `👑 *DONO CONFIGURADO COM SUCESSO!*` }, { quoted: msg });
        continue;
      }

      const isFreeCommand = ['/menualuguel', '/aluguel', '/alugar', '/menuadm', '/menu', '/ping', '/owner', '/dono', '/mtn', '/menuparceria', '/menujogos', '/menudono', '/sugestao', '/listsugestoes', '/upsugestao', '/rmsugestao', '/menulojacoin', '/catálogo', '/catalogo', '/carteira', '/comprar', '/trabalhar', '/roubar', '/minerar', '/minerios', '/venderminerios'].includes(command);

      if (isGroup && !isOwner && !isFreeCommand) {
        if (!isGroupRented(db.rentedGroups, from)) {
          await safeSendMessage(sock, from, { text: "Oii amorzinho! 🥰 Aluguel deste grupo não ativado. Digite /menualuguel." }, { quoted: msg });
          continue;
        }
      }

      if (command === '/minerar') {
        const now = Date.now();
        const cooldownMs = (db.gameConfigs?.mineCooldownHours || 6) * 3600000;
        const lastMine = db.cooldowns[`mine_${senderJid}`] || 0;
        if (now - lastMine < cooldownMs) {
          const remH = Math.ceil((cooldownMs - (now - lastMine)) / 3600000);
          await safeSendMessage(sock, from, { text: `⛏️ Braços cansados! Aguarde *${remH}h* para voltar à mina.` }, { quoted: msg });
          continue;
        }

        const pickaxe = db.shopProducts[db.userPickaxes[senderJid] || ''] || null;
        let baseAmount = Math.floor(Math.random() * 10) + 1 + (pickaxe?.extraOres || 0);
        if (!db.userOres[senderJid]) db.userOres[senderJid] = {};

        const minedSummary = {};
        for (let l = 0; l < (pickaxe?.doubleMine ? 2 : 1); l++) {
          for (let i = 0; i < baseAmount; i++) {
            const ore = getRandomOre(pickaxe?.rareBoost || 1.0);
            db.userOres[senderJid][ore.id] = (db.userOres[senderJid][ore.id] || 0) + 1;
            minedSummary[ore.name] = (minedSummary[ore.name] || 0) + 1;
          }
        }
        db.cooldowns[`mine_${senderJid}`] = now;
        saveDatabase(db);

        let report = `⛏️ *MINERAÇÃO CONCLUÍDA!*\n🔨 ${pickaxe ? pickaxe.name : "Enxada Simples"}\n\n`;
        for (const [oName, count] of Object.entries(minedSummary)) report += `› ${count}x${oName}\n`;
        await safeSendMessage(sock, from, { text: report }, { quoted: msg });
        continue;
      }

      if (command === '/minerios') {
        const ores = db.userOres[senderJid] || {};
        const entries = Object.entries(ores).filter(([_, c]) => c > 0);
        if (entries.length === 0) {
          await safeSendMessage(sock, from, { text: "📦 Inventário de minérios vazio! Use `/minerar`." }, { quoted: msg });
          continue;
        }
        let invText = `📦 *INVENTÁRIO DE @${userNumber}*\n\n`;
        const mult = db.shopProducts[db.userPickaxes[senderJid] || '']?.multiplier || 1;
        let totalVal = 0;
        for (const [id, count] of entries) {
          const ore = ORES[id];
          if (ore) {
            const val = ore.basePrice * count * mult;
            totalVal += val;
            invText += `${ore.icon}${ore.name}: ${count}x (${val}¢)\n`;
          }
        }
        invText += `\n💰 Total Estimado: ${totalVal}¢\nUse \`/venderminerios todos\``;
        await safeSendMessage(sock, from, { text: invText, mentions: [senderJid] }, { quoted: msg });
        continue;
      }

      if (command === '/venderminerios') {
        const targetOre = args[0]?.toLowerCase();
        const userOres = db.userOres[senderJid] || {};
        const mult = db.shopProducts[db.userPickaxes[senderJid] || '']?.multiplier || 1;

        if (!targetOre) {
          await safeSendMessage(sock, from, { text: "⚠️ Use `/venderminerios todos` ou `/venderminerios diamante`" }, { quoted: msg });
          continue;
        }

        if (targetOre === 'todos') {
          let totalEarned = 0, countTot = 0;
          for (const [id, count] of Object.entries(userOres)) {
            if (count > 0 && ORES[id]) {
              totalEarned += ORES[id].basePrice * count * mult;
              countTot += count;
              db.userOres[senderJid][id] = 0;
            }
          }
          if (totalEarned === 0) {
            await safeSendMessage(sock, from, { text: "⚠️ Nenhum minério para vender!" }, { quoted: msg });
            continue;
          }
          updateBalance(db, senderJid, totalEarned);
          saveDatabase(db);
          await safeSendMessage(sock, from, { text: `💰 Vendeu ${countTot} minérios e faturou *+${totalEarned}¢*!` }, { quoted: msg });
          continue;
        }

        const oreKey = Object.keys(ORES).find(k => k === targetOre || ORES[k].name.toLowerCase() === targetOre);
        if (!oreKey || !userOres[oreKey] || userOres[oreKey] <= 0) {
          await safeSendMessage(sock, from, { text: "⚠️ Você não possui este minério." }, { quoted: msg });
          continue;
        }
        const count = userOres[oreKey];
        const earned = ORES[oreKey].basePrice * count * mult;
        db.userOres[senderJid][oreKey] = 0;
        updateBalance(db, senderJid, earned);
        saveDatabase(db);
        await safeSendMessage(sock, from, { text: `💰 Vendeu ${count}x ${ORES[oreKey].name} por *+${earned}¢*!` }, { quoted: msg });
        continue;
      }

      if (command === '/menulojacoin') {
        await safeSendMessage(sock, from, { text: `🛍️ *LOJINHA LUNAR COINS*\n\n› /carteira - Ver saldo\n› /catálogo - Ver produtos e picaretas\n› /minerios - Ver minérios\n› /venderminerios todos - Vender minérios\n› /comprar <id> - Comprar item` }, { quoted: msg });
        continue;
      }

      if (command === '/catálogo' || command === '/catalogo') {
        let catText = `🛍️ *CATÁLOGO LUNAR COIN*\n\n`;
        for (const p of Object.values(db.shopProducts)) {
          catText += `📦 *${p.name}* (\`${p.id}\`)\n📋 ${p.desc}\n💳 *${p.price}¢*\n👉 \`/comprar ${p.id}\`\n──────────────────\n`;
        }
        await safeSendMessage(sock, from, { text: catText }, { quoted: msg });
        continue;
      }

      if (command === '/comprar') {
        const prod = db.shopProducts[args[0]?.toLowerCase()];
        if (!prod) {
          await safeSendMessage(sock, from, { text: "⚠️ Produto não encontrado! Use `/catálogo`." }, { quoted: msg });
          continue;
        }
        if (getBalance(db, senderJid) < prod.price) {
          await safeSendMessage(sock, from, { text: `⚠️ Saldo insuficiente! Custa ${prod.price}¢.` }, { quoted: msg });
          continue;
        }
        updateBalance(db, senderJid, -prod.price);

        if (args[0] === 'trocar_profissao') {
          const newProf = getRandomProfession();
          db.userProfessions[senderJid] = newProf;
          saveDatabase(db);
          await safeSendMessage(sock, from, { text: `🎉 Nova profissão: **${newProf.name}** (${newProf.multiplier}x)!` }, { quoted: msg });
          continue;
        }
        if (args[0].startsWith('picareta_')) {
          db.userPickaxes[senderJid] = args[0];
          saveDatabase(db);
          await safeSendMessage(sock, from, { text: `🎉 Picareta *${prod.name}* equipada com sucesso!` }, { quoted: msg });
          continue;
        }
        await safeSendMessage(sock, from, { text: `🎉 Compra de *${prod.name}* efetuada com sucesso!` }, { quoted: msg });
        continue;
      }

      if (command === '/trabalhar') {
        const now = Date.now();
        const cooldownMs = (db.gameConfigs?.workCooldownHours || 24) * 3600000;
        if (now - (db.cooldowns[`work_${senderJid}`] || 0) < cooldownMs) {
          await safeSendMessage(sock, from, { text: `💼 CLT INFORMA: Você já cumpriu suas 8h de trabalho hoje. Volte amanhã!` }, { quoted: msg });
          continue;
        }
        if (!db.userProfessions[senderJid]) db.userProfessions[senderJid] = getRandomProfession();
        const prof = db.userProfessions[senderJid];
        const salary = Math.floor((db.gameConfigs?.minSalary || 50) * prof.multiplier);
        updateBalance(db, senderJid, salary);
        db.cooldowns[`work_${senderJid}`] = now;
        saveDatabase(db);
        await safeSendMessage(sock, from, { text: `🛠️ Trabalho concluído! Profissão: ${prof.name} | Salário: +${salary}¢` }, { quoted: msg });
        continue;
      }

      if (command === '/roubar') {
        const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
        if (!target || target === senderJid) {
          await safeSendMessage(sock, from, { text: "⚠️ Marque alguém para roubar: `/roubar @mencao`" }, { quoted: msg });
          continue;
        }
        const now = Date.now();
        const cooldownMs = (db.gameConfigs?.robCooldownHours || 12) * 3600000;
        if (now - (db.cooldowns[`rob_${senderJid}`] || 0) < cooldownMs) {
          await safeSendMessage(sock, from, { text: "🥷 A polícia está na cola! Aguarde o cooldown." }, { quoted: msg });
          continue;
        }
        const vBal = getBalance(db, target);
        if (vBal < 25) {
          await safeSendMessage(sock, from, { text: "🥷 Vítima sem saldo suficiente (mínimo 25¢)." }, { quoted: msg });
          continue;
        }
        if (Math.random() <= 0.50) {
          const stolen = Math.floor(Math.random() * (Math.floor(vBal * 0.70) - 25 + 1)) + 25;
          updateBalance(db, target, -stolen);
          updateBalance(db, senderJid, stolen);
          db.cooldowns[`rob_${senderJid}`] = now;
          saveDatabase(db);
          await safeSendMessage(sock, from, { text: `🥷 Roubou *${stolen}¢* de @${target.split('@')[0]}!`, mentions: [target] });
        } else {
          const pen = Math.min(20, getBalance(db, senderJid));
          updateBalance(db, senderJid, -pen);
          db.cooldowns[`rob_${senderJid}`] = now;
          saveDatabase(db);
          await safeSendMessage(sock, from, { text: `🚨 Pego em flagrante! Pagou ${pen}¢ de fiança.` });
        }
        continue;
      }

      if (command === '/menujogos') {
        const gamesMenu = `🤖 LUNAR SYSTEM ©\n\n❖ 🎰 CASSINO & APOSTAS\n› /dados <valor>\n› /dardo <valor>\n› /slots <valor>\n› /velha @rival <valor>\n\n❖ 💼 AÇÕES & PVP\n› /trabalhar\n› /roubar @mencao\n› /minerar\n\n❖ 💰 ECONOMIA & LOJINHA\n› /carteira\n› /minerios\n› /venderminerios todos\n› /menulojacoin`;
        await safeSendMessage(sock, from, { text: gamesMenu }, { quoted: msg });
        continue;
      }

      if (command === '/carteira') {
        const bal = getBalance(db, senderJid);
        const prof = db.userProfessions[senderJid]?.name || "Desempregado";
        const pick = db.shopProducts[db.userPickaxes[senderJid] || '']?.name || "Enxada Simples";
        await safeSendMessage(sock, from, { text: `💳 *CARTEIRA*\n👤 @${userNumber}\n💼 ${prof}\n🔨 ${pick}\n💰 Saldo: ${bal}¢`, mentions: [senderJid] }, { quoted: msg });
        continue;
      }

      if (command === '/dados') {
        const bet = parseInt(args[0]);
        if (isNaN(bet) || bet <= 0 || bet > getBalance(db, senderJid)) {
          await safeSendMessage(sock, from, { text: "⚠️ Aposta inválida ou saldo insuficiente." }, { quoted: msg });
          continue;
        }
        const streak = db.diceWinStreak[senderJid] || 0;
        let diff = 1.0 + (streak * 0.05) + (bet >= 10 ? Math.min(0.70, (bet / 1000000) * 0.70) : 0);
        const roll = Math.random() < Math.min(0.85, 0.1666 * diff) ? 1 : Math.floor(Math.random() * 5) + 2;

        if (roll === 1) {
          updateBalance(db, senderJid, -bet);
          db.diceWinStreak[senderJid] = 0;
          saveDatabase(db);
          await safeSendMessage(sock, from, { text: `🎲 Caiu em [ 1 ]! Perdeu ${bet}¢.` }, { quoted: msg });
        } else {
          const win = bet * (roll - 1);
          updateBalance(db, senderJid, win);
          db.diceWinStreak[senderJid] = streak + 1;
          saveDatabase(db);
          await safeSendMessage(sock, from, { text: `🎲 Caiu em [ ${roll} ]! Ganhou +${win}¢ (${roll}x).` }, { quoted: msg });
        }
        continue;
      }

      if (command === '/dardo') {
        const bet = parseInt(args[0]);
        if (isNaN(bet) || bet <= 0 || bet > getBalance(db, senderJid)) {
          await safeSendMessage(sock, from, { text: "⚠️ Aposta inválida." }, { quoted: msg });
          continue;
        }
        if (Math.random() <= 0.40) {
          updateBalance(db, senderJid, bet);
          await safeSendMessage(sock, from, { text: `🎯 Bullseye! Ganhou +${bet}¢ (2x).` });
        } else {
          updateBalance(db, senderJid, -bet);
          await safeSendMessage(sock, from, { text: `🎯 Errou! Perdeu ${bet}¢.` });
        }
        continue;
      }

      if (command === '/slots') {
        const bet = parseInt(args[0]);
        if (isNaN(bet) || bet <= 0 || bet > getBalance(db, senderJid)) {
          await safeSendMessage(sock, from, { text: "⚠️ Aposta inválida." }, { quoted: msg });
          continue;
        }
        const symbols = ['🥐', '🪐', '🚀', '💎', '🌙'];
        const r = Math.random();
        let mult = r < 0.03 ? 10 : r < 0.10 ? 5 : r < 0.22 ? 3 : r < 0.40 ? 2 : 0;
        let s1 = symbols[Math.floor(Math.random() * symbols.length)];
        let s2 = symbols[Math.floor(Math.random() * symbols.length)];
        let s3 = mult > 0 ? s1 : symbols[Math.floor(Math.random() * symbols.length)];

        if (mult > 0) {
          const win = bet * (mult - 1);
          updateBalance(db, senderJid, win);
          await safeSendMessage(sock, from, { text: `🎰 [ ${s1} | ${s2} | ${s3} ]\n🎉 *JACKPOT ${mult}X!* +${win}¢` });
        } else {
          updateBalance(db, senderJid, -bet);
          await safeSendMessage(sock, from, { text: `🎰 [ ${s1} | ${s2} | ${s3} ]\n💥 Perdeu ${bet}¢.` });
        }
        continue;
      }

      if (command === '/menu') {
        await safeSendMessage(sock, from, { text: `🤖 LUNAR BOT\n› /menujogos\n› /menulojacoin\n› /menuadm\n› /ping` }, { quoted: msg });
        continue;
      }

      if (command === '/ping') {
        const start = Date.now();
        await safeSendMessage(sock, from, { text: `🏓 Pong! ${Date.now() - start}ms` }, { quoted: msg });
        continue;
      }

      if (command === '/owner' || command === '/dono') {
        const vcard = 'BEGIN:VCARD\nVERSION:3.0\nFN:MONTANHA DEV\nTEL;type=CELL;waid=5562982520428:+5562982520428\nEND:VCARD';
        await safeSendMessage(sock, from, { contacts: { displayName: "MONTANHA DEV", contacts: [{ vcard }] } }, { quoted: msg });
        continue;
      }

      if (db.customCommands[command.replace('/', '')]) {
        await safeSendMessage(sock, from, { text: db.customCommands[command.replace('/', '')] }, { quoted: msg });
        continue;
      }
    }
  });
}

startBot();
