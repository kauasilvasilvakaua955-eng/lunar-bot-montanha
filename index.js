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

function loadDatabase() {
  if (!fs.existsSync(DB_PATH)) {
    const defaultData = {
      ownerJid: null,
      ownerName: "MONTANHA DEV",
      ownerNumber: FIXED_OWNER_NUMBER,
      rentedGroups: {},
      blacklistedUsers: [],
      customCommands: {},
      groupSettings: {},
      partners: {},
      groupSchedules: {},
      mutedUsers: {},
      wallets: {},
      groupRequests: {},
      requestCounter: 1,
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
    if (data.requestCounter === undefined) data.requestCounter = 1;
    if (!data.rentalPlans) data.rentalPlans = {
      "1_dia": { name: "1 Dia de Aluguel", days: 1, price: 2.00 },
      "7_dias": { name: "7 Dias de Aluguel", days: 7, price: 10.00 },
      "30_dias": { name: "30 Dias de Aluguel", days: 30, price: 30.00 }
    };
    return data;
  } catch {
    return { ownerJid: null, ownerName: "MONTANHA DEV", ownerNumber: FIXED_OWNER_NUMBER, rentedGroups: {}, blacklistedUsers: [], customCommands: {}, groupSettings: {}, partners: {}, groupSchedules: {}, mutedUsers: {}, wallets: {}, groupRequests: {}, requestCounter: 1, rentalPlans: {} };
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

function calculateHouseTax(amount) {
  return Math.max(1, Math.floor(amount * 0.03));
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
    console.log(`⚠️ Não foi possível enviar mensagem em ${jid}: ${err.message}`);
    return null;
  }
}

async function generateQrBuffer(text) {
  if (!text || typeof text !== 'string') return null;
  try {
    return await QRCode.toBuffer(text, { type: 'png', margin: 2, scale: 8 });
  } catch (e) {
    console.error('Erro ao gerar imagem de QR Code:', e.message);
    return null;
  }
}

function extractPixString(chargeObj) {
  if (!chargeObj) return null;
  if (typeof chargeObj === 'string') return chargeObj;
  
  return chargeObj.pix?.brCode || 
         chargeObj.pix?.code || 
         chargeObj.brCode || 
         chargeObj.pixCopiaECola || 
         chargeObj.code || 
         chargeObj.pixCode || 
         chargeObj.qrcode || 
         chargeObj.payload || 
         chargeObj.data?.pix?.brCode ||
         chargeObj.data?.pixCopiaECola || 
         chargeObj.data?.code || 
         null;
}

function extractInviteCode(text) {
  const match = text.match(/(?:https?:\/\/)?(?:chat\.whatsapp\.com\/)?([0-9A-Za-z]{20,24})/i);
  return match ? match[1] : null;
}

function initBackgroundTasks(sock) {
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
          await safeSendMessage(sock, groupJid, { 
            text: `🔓 O tempo de silenciamento de @${userJid.split('@')[0]} expirou e ele foi desmutado automaticamente!`, 
            mentions: [userJid] 
          });
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

  if (unit === 'h') {
    if (value < 1 || value > 24) return null;
    return value * 60 * 60 * 1000;
  } else if (unit === 'd') {
    if (value < 1 || value > 366) return null;
    return value * 24 * 60 * 60 * 1000;
  }
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
        console.log('⏳ Aguardando handshake para gerar código de 8 dígitos...');
        await new Promise(resolve => setTimeout(resolve, 8000));
        const pairingCode = await sock.requestPairingCode(config.DEFAULT_BOT_NUMBER);
        console.log('\n========================================');
        console.log(`📌 CÓDIGO DE PAREAMENTO LUNAR BOT: ${pairingCode}`);
        console.log('========================================\n');
      } catch (err) {
        console.error('❌ Erro ao solicitar Código de Pareamento:', err.message);
      }
    }, 5000);
  }

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      
      console.log(`⚠️ Conexão fechada (Código: ${statusCode || 'Desconhecido'}). Reconectando automaticamente...`);
      
      if (shouldReconnect) {
        setTimeout(() => startBot(), 4000);
      } else {
        console.log('❌ Sessão encerrada ou logout detectado.');
      }
    } else if (connection === 'open') {
      console.log(`\n✅ ${config.BOT_NAME} CONECTADO COM SUCESSO VIA LUNAR SYSTEM ENGINE!\n`);
      initBackgroundTasks(sock);
    }
  });

  sock.ev.on('group-participants.update', async (update) => {
    const { id: groupJid, participants, action } = update;
    db = loadDatabase();
    const settings = db.groupSettings[groupJid] || {};

    if (action === 'add' && settings.welcome) {
      for (const participant of participants) {
        const userNum = participant.split('@')[0];
        const groupMeta = await sock.groupMetadata(groupJid).catch(() => ({ subject: 'este grupo', participants: [] }));
        const memberCount = groupMeta.participants.length;

        const welcomeText = `Oii amorzinho! Seja muito bem-vindo(a) ao grupo *${groupMeta.subject}*! 🌙✨\n` +
          `👤 Novo membro: @${userNum}\n` +
          `📊 Nosso grupo agora conta com *${memberCount}* fofos reunidos!\n` +
          `Aproveite sua estadia e siga as regras. Beijinhos da Lunar 💋👋`;

        await safeSendMessage(sock, groupJid, { text: welcomeText, mentions: [participant] }).catch(() => {});
      }
    }

    if (action === 'remove' && settings.saida) {
      const saidaText = `Poxa... Mais um corpinho que parte para outro universo... 🌌💔 O vento sopra frio na Lunar System e sentimos uma tristeza profunda por ver um membro nos deixar... Até logo! 🌙💧`;
      await safeSendMessage(sock, groupJid, { text: saidaText }).catch(() => {});
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

      const text = msg.message.conversation ||
                   msg.message.extendedTextMessage?.text ||
                   msg.message.imageMessage?.caption ||
                   '';

      const trimmedText = text.trim();

      const isOwner = db.ownerJid && (
        senderJid === db.ownerJid ||
        senderJid.split('@')[0] === db.ownerJid.split('@')[0]
      );

      // RECEBIMENTO DE LINK DE GRUPO NO PRIVADO
      if (!isGroup && !trimmedText.startsWith('/')) {
        const inviteCode = extractInviteCode(trimmedText);
        if (inviteCode) {
          const reqId = String(db.requestCounter || 1).padStart(3, '0');
          db.requestCounter = (db.requestCounter || 1) + 1;

          if (!db.groupRequests) db.groupRequests = {};
          db.groupRequests[reqId] = {
            link: trimmedText,
            inviteCode: inviteCode,
            sender: senderJid,
            timestamp: Date.now()
          };
          saveDatabase(db);

          if (db.ownerJid) {
            const alertMsg = `🚨 *NOVA SOLICITAÇÃO DE ENTRADA EM GRUPO* 🌙\n\n` +
              `🆔 *ID:* \`${reqId}\`\n` +
              `👤 *Enviado por:* @${userNumber}\n` +
              `🔗 *Link:* ${trimmedText}\n\n` +
              `👉 Para aprovar este grupo, digite:\n\`/aprovargrupo ${reqId}\`\n` +
              `Ou aprove todos digitando:\n\`/aprovartodosgrupos\``;
            
            await safeSendMessage(sock, db.ownerJid, { text: alertMsg, mentions: [senderJid] });
          }

          await safeSendMessage(sock, from, { text: "🌙 Link de grupo recebido! O Dono Supremo foi notificado e avaliará a entrada do bot." }, { quoted: msg });
          continue;
        }
      }

      // SESSÕES INTERATIVAS DO DONO
      if (isOwner && ownerInteractiveSessions.has(senderJid)) {
        const session = ownerInteractiveSessions.get(senderJid);

        if (session.step === 'ADD_RENT_DAYS') {
          const days = parseInt(trimmedText);
          if (isNaN(days) || days <= 0) {
            await safeSendMessage(sock, from, { text: "⚠️ Informe um número válido de dias (ex: 30)." }, { quoted: msg });
            continue;
          }

          const targetGroup = session.targetGroup;
          const currentExpire = db.rentedGroups[targetGroup]?.expireAt || Date.now();
          const baseTime = currentExpire > Date.now() ? currentExpire : Date.now();
          const newExpire = baseTime + (days * 24 * 60 * 60 * 1000);

          db.rentedGroups[targetGroup] = { expireAt: newExpire };
          saveDatabase(db);

          ownerInteractiveSessions.delete(senderJid);
          await safeSendMessage(sock, from, { text: `✅ Aluguel de +${days} dias adicionado com sucesso para este grupo! (Acumulado)` }, { quoted: msg });
          continue;
        }

        if (session.step === 'ADD_TEMPO_EXTRA') {
          const hours = parseInt(trimmedText);
          if (isNaN(hours) || hours <= 0) {
            await safeSendMessage(sock, from, { text: "⚠️ Informe horas válidas (ex: 24)." }, { quoted: msg });
            continue;
          }

          const targetGroup = session.targetGroup;
          const currentExpire = db.rentedGroups[targetGroup]?.expireAt || Date.now();
          const baseTime = currentExpire > Date.now() ? currentExpire : Date.now();
          const newExpire = baseTime + (hours * 60 * 60 * 1000);

          db.rentedGroups[targetGroup] = { expireAt: newExpire };
          saveDatabase(db);

          ownerInteractiveSessions.delete(senderJid);
          await safeSendMessage(sock, from, { text: `✅ Tempo extra de +${hours} horas adicionado ao grupo!` }, { quoted: msg });
          continue;
        }

        if (session.step === 'GERAR_PAGAMENTO_VALOR') {
          const valor = parseFloat(trimmedText.replace(',', '.'));
          if (isNaN(valor) || valor <= 0) {
            await safeSendMessage(sock, from, { text: "⚠️ Valor inválido." }, { quoted: msg });
            continue;
          }
          ownerInteractiveSessions.delete(senderJid);

          try {
            await safeSendMessage(sock, from, { text: `⏳ Gerando PIX avulso de R$ ${valor.toFixed(2)} via Lunar Pay Engine...` }, { quoted: msg });
            const charge = await purincash.createPixCharge(valor, 'Cobrança Dono Lunar');
            const pixCode = extractPixString(charge);

            if (!pixCode) {
              await safeSendMessage(sock, from, { text: `❌ Não foi possível extrair o código PIX da resposta da API.` }, { quoted: msg });
              continue;
            }

            const qrBuffer = await generateQrBuffer(pixCode);
            if (qrBuffer) {
              await safeSendMessage(sock, from, { 
                image: qrBuffer, 
                caption: `✅ *PIX GERADO COM SUCESSO!*\n💵 *Valor:* R$ ${valor.toFixed(2)}\n\n📌 *Escaneie o QR Code acima ou use o Copia e Cola abaixo:*` 
              }, { quoted: msg });
            }

            await safeSendMessage(sock, from, { text: pixCode }, { quoted: msg });
          } catch (e) {
            await safeSendMessage(sock, from, { text: `❌ Erro ao gerar pagamento: ${e.message}` }, { quoted: msg });
          }
          continue;
        }

        if (session.step === 'SACAR_PIX_KEY') {
          const pixKey = trimmedText;
          ownerInteractiveSessions.delete(senderJid);

          try {
            await safeSendMessage(sock, from, { text: "⏳ Processando saque total para a chave PIX..." }, { quoted: msg });
            await purincash.withdrawAll(pixKey);
            await safeSendMessage(sock, from, { text: `✅ *SAQUE REALIZADO COM SUCESSO!*` }, { quoted: msg });
          } catch (e) {
            await safeSendMessage(sock, from, { text: `❌ Erro no saque: ${e.message}` }, { quoted: msg });
          }
          continue;
        }

        if (session.step === 'PAGAR_PIX_KEY') {
          session.pixKey = trimmedText;
          session.step = 'PAGAR_PIX_VALOR';
          ownerInteractiveSessions.set(senderJid, session);
          await safeSendMessage(sock, from, { text: "🌙 Digite o valor exato que deseja enviar:" }, { quoted: msg });
          continue;
        }

        if (session.step === 'PAGAR_PIX_VALOR') {
          const amount = parseFloat(trimmedText.replace(',', '.'));
          if (isNaN(amount) || amount <= 0) {
            await safeSendMessage(sock, from, { text: "⚠️ Valor inválido." }, { quoted: msg });
            continue;
          }
          const pixKey = session.pixKey;
          ownerInteractiveSessions.delete(senderJid);

          try {
            await safeSendMessage(sock, from, { text: "⏳ Efetuando pagamento..." }, { quoted: msg });
            await purincash.payPixWithMargin(pixKey, amount);
            
            const receipt = `🧾 *COMPROVANTE DE PAGAMENTO - LUNAR SYSTEM ©*\n\n` +
              `🏢 *Emitente:* Lunar System\n` +
              `💵 *Valor Líquido:* R$ ${amount.toFixed(2)}\n` +
              `🔑 *Chave PIX:* ${pixKey}\n` +
              `📌 *Status:* Aprovado e Pago com Sucesso!\n` +
              `📅 *Data:* ${new Date().toLocaleString('pt-BR')}`;

            await safeSendMessage(sock, from, { text: receipt }, { quoted: msg });
          } catch (e) {
            await safeSendMessage(sock, from, { text: `❌ Erro no pagamento: ${e.message}` }, { quoted: msg });
          }
          continue;
        }

        if (session.step === 'ADD_CMD_NAME') {
          session.newCmdName = trimmedText.toLowerCase();
          session.step = 'ADD_CMD_TEXT';
          ownerInteractiveSessions.set(senderJid, session);
          await safeSendMessage(sock, from, { text: "🌙 Envie o texto que o bot deve responder ao acionar este comando:" }, { quoted: msg });
          continue;
        }

        if (session.step === 'ADD_CMD_TEXT') {
          db.customCommands[session.newCmdName] = trimmedText;
          saveDatabase(db);
          ownerInteractiveSessions.delete(senderJid);
          await safeSendMessage(sock, from, { text: `✅ Comando \`/${session.newCmdName}\` criado com sucesso!` }, { quoted: msg });
          continue;
        }

        if (session.step === 'BROADCAST_TEXT') {
          const textMsg = trimmedText;
          ownerInteractiveSessions.delete(senderJid);

          const activeGroups = Object.keys(db.rentedGroups).filter(jid => isGroupRented(db.rentedGroups, jid));
          let count = 0;
          for (const gJid of activeGroups) {
            try {
              await safeSendMessage(sock, gJid, { text: `📢 *COMUNICADO LUNAR SYSTEM ©*\n\n${textMsg}` });
              count++;
            } catch {}
          }
          await safeSendMessage(sock, from, { text: `✅ Broadcast disparado para ${count} grupos ativos!` }, { quoted: msg });
          continue;
        }
      }

      // JOGO DA VELHA
      if (isGroup && tictactoeGames.has(from) && /^[1-9]$/.test(trimmedText)) {
        const game = tictactoeGames.get(from);
        if (game.turn === senderJid) {
          const pos = parseInt(trimmedText) - 1;
          if (game.board[pos] === ' ') {
            game.board[pos] = game.turn === game.player1 ? '❌' : '⭕';
            
            const winPatterns = [
              [0,1,2], [3,4,5], [6,7,8],
              [0,3,6], [1,4,7], [2,5,8],
              [0,4,8], [2,4,6]
            ];
            const isWin = winPatterns.some(p => game.board[p[0]] !== ' ' && game.board[p[0]] === game.board[p[1]] && game.board[p[1]] === game.board[p[2]]);

            if (isWin) {
              const houseTax = calculateHouseTax(game.bet);
              const prize = (game.bet * 2) - houseTax;
              updateBalance(db, senderJid, prize);
              
              tictactoeGames.delete(from);
              await safeSendMessage(sock, from, { 
                text: `🎉 *FIM DE JOGO!* @${senderJid.split('@')[0]} venceu a partida de Jogo da Velha!\n💰 *Prêmio Líquido:* +${prize}¢ (Taxa da casa: ${houseTax}¢)`,
                mentions: [senderJid]
              });
              continue;
            }

            if (!game.board.includes(' ')) {
              updateBalance(db, game.player1, game.bet);
              updateBalance(db, game.player2, game.bet);
              tictactoeGames.delete(from);
              await safeSendMessage(sock, from, { text: "🤝 *EMPATE!* O jogo da velha terminou sem vencedores. O valor das apostas foi devolvido aos jogadores." });
              continue;
            }

            game.turn = game.turn === game.player1 ? game.player2 : game.player1;
            tictactoeGames.set(from, game);

            const boardDisplay = `🎮 *JOGO DA VELHA VALENDO ${game.bet}¢*\n\n` +
              `1️⃣ ${game.board[0]} | 2️⃣ ${game.board[1]} | 3️⃣ ${game.board[2]}\n` +
              `4️⃣ ${game.board[3]} | 5️⃣ ${game.board[4]} | 6️⃣ ${game.board[5]}\n` +
              `7️⃣ ${game.board[6]} | 8️⃣ ${game.board[7]} | 9️⃣ ${game.board[8]}\n\n` +
              `👉 Vez do jogador: @${game.turn.split('@')[0]} (Responda com o número de 1 a 9)`;
            await safeSendMessage(sock, from, { text: boardDisplay, mentions: [game.turn] });
            continue;
          }
        }
      }

      // MODERAÇÃO EM MENSAGENS NORMAIS
      if (isGroup && !isOwner) {
        const settings = db.groupSettings[from] || {};

        const now = Date.now();
        if (!spamTracker.has(senderJid)) spamTracker.set(senderJid, []);
        const userMsgs = spamTracker.get(senderJid).filter(t => now - t < 3000);
        userMsgs.push(now);
        spamTracker.set(senderJid, userMsgs);

        if (userMsgs.length >= 5 && settings.antispam) {
          await sock.sendMessage(from, { delete: msg.key }).catch(() => {});
          await sock.groupParticipantsUpdate(from, [senderJid], 'demote').catch(() => {});
          await safeSendMessage(sock, from, { text: `⚠️ @${userNumber} foi mutado por motivo de SPAM!`, mentions: [senderJid] });
          continue;
        }

        const hasLink = /https?:\/\/|www\.|t\.me|wa\.me|discord\.gg|tiktok\.com|youtube\.com|instagram\.com|\.com/i.test(text);

        if (hasLink) {
          if (settings.modoparceria) {
            const todayStr = new Date().toISOString().split('T')[0];
            if (!db.partners[from]) db.partners[from] = {};
            const partnerData = db.partners[from][senderJid];

            if (partnerData) {
              if (partnerData.resetDate !== todayStr) {
                partnerData.used = 0;
                partnerData.resetDate = todayStr;
              }
              if (partnerData.used < partnerData.limit) {
                partnerData.used++;
                saveDatabase(db);
                continue;
              } else {
                await sock.sendMessage(from, { delete: msg.key }).catch(() => {});
                await safeSendMessage(sock, from, { text: `⚠️ @${userNumber}, você excedeu a sua quantidade diária de links permitidos como parceiro!`, mentions: [senderJid] });
                continue;
              }
            } else {
              await sock.sendMessage(from, { delete: msg.key }).catch(() => {});
              await safeSendMessage(sock, from, { text: `⚠️ @${userNumber}, para enviar links neste grupo é necessário ter parceria oficial cadastrada! Digite */menuparceria* para saber mais.`, mentions: [senderJid] });
              continue;
            }
          }

          if (settings.antilinkgeral) {
            await sock.sendMessage(from, { delete: msg.key }).catch(() => {});
            await safeSendMessage(sock, from, { text: `⚠️ Links são estritamente proibidos neste grupo por @${userNumber}!`, mentions: [senderJid] });
            continue;
          }
          if (settings.antilink2) {
            await sock.sendMessage(from, { delete: msg.key }).catch(() => {});
            await sock.groupParticipantsUpdate(from, [senderJid], 'remove').catch(() => {});
            await safeSendMessage(sock, from, { text: `🚫 @${userNumber} foi banido por enviar link proibido!`, mentions: [senderJid] });
            continue;
          }
          if (settings.antilink1) {
            await sock.sendMessage(from, { delete: msg.key }).catch(() => {});
            await safeSendMessage(sock, from, { text: `⚠️ Proibido envio de links neste grupo, @${userNumber}!`, mentions: [senderJid] });
            continue;
          }
        }
      }

      // DECLARAÇÃO DOS COMANDOS
      const command = trimmedText.split(' ')[0].toLowerCase();
      const args = trimmedText.split(' ').slice(1);

      // RESPOSTA NO PRIVADO
      if (!isGroup && !isOwner) {
        const inviteCode = extractInviteCode(trimmedText);
        if (!inviteCode && command !== '/owner' && command !== '/dono' && command !== '/mtn') {
          const pvText = "Oii amorzinho 🥰, sou a lunar 🌙 o bot de automação da Lunar System ©, não respondo privado pois fui feito para grupos, caso aja dúvidas digite /OWNER e entre em contato com meu criador. beijinhos 💋👋\n\n" +
            "Caso queira que o nosso bot participe do seu grupo, basta enviar o link de convite do seu grupo neste chat e aguarde que a nossa equipe de staff avaliará a possibilidade e aceitará a entrada da Lunar no seu grupo! ✨🌙";
          
          await safeSendMessage(sock, from, { text: pvText }, { quoted: msg });
          continue;
        }
      }

      // REGRA ESTRITA DE PREFIXO
      if (!trimmedText.startsWith('/')) continue;

      const commandNotFoundMsg = "❌ Comando não encontrado! Digite /menu para ver a lista de comandos.";

      if (command === '/mtn') {
        db.ownerJid = senderJid;
        db.ownerNumber = FIXED_OWNER_NUMBER;
        db.ownerName = "MONTANHA DEV";
        saveDatabase(db);

        await safeSendMessage(sock, from, { text: `👑 *DONO SUPREMO CONFIGURADO COM SUCESSO!*\n\n👤 *Nome:* MONTANHA DEV\n📱 *Número:* +${FIXED_OWNER_NUMBER}` }, { quoted: msg });
        continue;
      }

      const isFreeCommand = ['/menualuguel', '/aluguel', '/alugar', '/menuadm', '/menu', '/ping', '/owner', '/dono', '/mtn', '/menuparceria', '/menujogos', '/menudono'].includes(command);

      if (isGroup && !isOwner && !isFreeCommand) {
        const hasRent = isGroupRented(db.rentedGroups, from);

        if (!hasRent) {
          await safeSendMessage(sock, from, { text: "Oii meus amores! 🥰 O aluguel deste grupo ainda não foi ativado! 🌙 Digite /menualuguel para ver os planos e ativar sua assinatura. Beijinhos 💋👋" }, { quoted: msg });
          continue;
        }
      }

      if (command === '/menudono') {
        if (!isOwner) {
          await safeSendMessage(sock, from, { text: commandNotFoundMsg }, { quoted: msg });
          continue;
        }

        const donoMenu = `🤖 LUNAR BOT | LUNAR SYSTEM ©\n\n` +
          `❖ 👑 PAINEL DO DONO\n` +
          `› /menudono - Acessa o painel do dono\n` +
          `› /addaluguel - Adiciona dias de aluguel\n` +
          `› /rmaluguel - Remove o aluguel do grupo\n` +
          `› /addtempoextra - Soma horas extras\n` +
          `› /listalugueis - Lista todos os grupos alugados\n` +
          `› /gerarpagamento - Gera cobrança PIX avulsa\n` +
          `› /saldo - Consulta saldo da carteira Lunar\n` +
          `› /sacar - Realiza saque total via PIX\n` +
          `› /pagar - Envia PIX com margem\n` +
          `› /blockbot - Bloqueia usuário no bot\n` +
          `› /rmblockbot - Desbloqueia usuário\n` +
          `› /addnewcomando - Cria comando personalizado\n` +
          `› /ang - Dispara comunicado global\n\n` +
          `✦ LUNAR SYSTEM © ✨`;

        await safeSendMessage(sock, from, { text: donoMenu }, { quoted: msg });
        continue;
      }

      if (command === '/listsolicitacoesgrupo') {
        if (!isOwner) {
          await safeSendMessage(sock, from, { text: commandNotFoundMsg }, { quoted: msg });
          continue;
        }

        const reqs = db.groupRequests || {};
        const entries = Object.entries(reqs);

        if (entries.length === 0) {
          await safeSendMessage(sock, from, { text: "📋 Nenhuma solicitação de entrada em grupo pendente no momento." }, { quoted: msg });
          continue;
        }

        let rep = `📋 *SOLICITAÇÕES DE ENTRADA EM GRUPO* 🌙\n\n`;
        for (const [id, data] of entries) {
          rep += `🆔 *ID:* \`${id}\`\n` +
            `👤 *Usuário:* @${data.sender.split('@')[0]}\n` +
            `🔗 *Link:* ${data.link}\n` +
            `──────────────────────────\n`;
        }
        await safeSendMessage(sock, from, { text: rep }, { quoted: msg });
        continue;
      }

      if (command === '/aprovargrupo') {
        if (!isOwner) {
          await safeSendMessage(sock, from, { text: commandNotFoundMsg }, { quoted: msg });
          continue;
        }

        const reqId = args[0];
        if (!reqId || !db.groupRequests?.[reqId]) {
          await safeSendMessage(sock, from, { text: "⚠️ ID de solicitação inválido ou não encontrado. Use `/listsolicitacoesgrupo` para ver os IDs." }, { quoted: msg });
          continue;
        }

        const reqData = db.groupRequests[reqId];
        try {
          await safeSendMessage(sock, from, { text: `⏳ Entrando no grupo da solicitação \`${reqId}\`...` }, { quoted: msg });
          await sock.groupAcceptInvite(reqData.inviteCode);
          delete db.groupRequests[reqId];
          saveDatabase(db);
          await safeSendMessage(sock, from, { text: `✅ *BOT ADICIONADO COM SUCESSO AO GRUPO!*\nSolicitação \`${reqId}\` aprovada e removida da lista.` }, { quoted: msg });
        } catch (e) {
          await safeSendMessage(sock, from, { text: `❌ Erro ao entrar no grupo: ${e.message}` }, { quoted: msg });
        }
        continue;
      }

      if (command === '/aprovartodosgrupos') {
        if (!isOwner) {
          await safeSendMessage(sock, from, { text: commandNotFoundMsg }, { quoted: msg });
          continue;
        }

        const reqs = db.groupRequests || {};
        const entries = Object.entries(reqs);

        if (entries.length === 0) {
          await safeSendMessage(sock, from, { text: "📋 Nenhuma solicitação pendente para aprovar." }, { quoted: msg });
          continue;
        }

        await safeSendMessage(sock, from, { text: `⏳ Processando a entrada em ${entries.length} grupo(s)...` }, { quoted: msg });
        let successCount = 0;

        for (const [id, data] of entries) {
          try {
            await sock.groupAcceptInvite(data.inviteCode);
            delete db.groupRequests[id];
            successCount++;
          } catch {}
        }

        saveDatabase(db);
        await safeSendMessage(sock, from, { text: `✅ *APROVAÇÃO EM MASSA CONCLUÍDA!*\nO bot entrou com sucesso em ${successCount} de ${entries.length} grupo(s).` }, { quoted: msg });
        continue;
      }

      if (command === '/menuadm') {
        const admMenu = `🤖 LUNAR BOT | LUNAR SYSTEM ©\n\n` +
          `❖ 🛡️ ADMINISTRAÇÃO & GRUPOS\n` +
          `› /menuadm - Exibe este painel admin\n` +
          `› /gp a ou /gp f - Abre ou fecha o grupo\n` +
          `› /gptime <hh:mm> <hh:mm> - Agendamento automático\n` +
          `› /welcome [on/off] - Alterna boas-vindas\n` +
          `› /saida [on/off] - Alterna aviso de saída\n` +
          `› /jogos [on/off] - Ativa ou desliga os minigames\n` +
          `› /ban @membro - Banir membro do grupo\n` +
          `› /promover @membro - Promover a administrador\n` +
          `› /rebaixar @membro - Rebaixar administrador\n` +
          `› /mute @membro - Silenciar membro\n` +
          `› /mutetemp @membro <1h/1d> - Silenciar temporário\n` +
          `› /unmute @membro - Retirar silenciamento\n` +
          `› /listmutados - Lista membros silenciados\n` +
          `› /tagall - Marcação geral de todos\n` +
          `› /limparchat - Limpa o chat do grupo\n\n` +
          `✦ LUNAR SYSTEM © ✨`;

        await safeSendMessage(sock, from, { text: admMenu }, { quoted: msg });
        continue;
      }

      if (command === '/addaluguel' && isOwner) {
        ownerInteractiveSessions.set(senderJid, { step: 'ADD_RENT_DAYS', targetGroup: from });
        await safeSendMessage(sock, from, { text: "🌙 Quantos dias de aluguel você deseja adicionar/acumular neste grupo?" }, { quoted: msg });
        continue;
      }

      if (command === '/rmaluguel' && isOwner) {
        delete db.rentedGroups[from];
        saveDatabase(db);
        await safeSendMessage(sock, from, { text: "🚫 Aluguel deste grupo removido com sucesso!" }, { quoted: msg });
        continue;
      }

      if (command === '/addtempoextra' && isOwner) {
        ownerInteractiveSessions.set(senderJid, { step: 'ADD_TEMPO_EXTRA', targetGroup: from });
        await safeSendMessage(sock, from, { text: "🌙 Quantas horas extras deseja somar ao aluguel deste grupo?" }, { quoted: msg });
        continue;
      }

      if (command === '/listalugueis' && isOwner) {
        const groups = Object.entries(db.rentedGroups);
        if (groups.length === 0) {
          await safeSendMessage(sock, from, { text: "📋 Nenhum grupo cadastrado no sistema no momento." }, { quoted: msg });
          continue;
        }

        let report = `📋 *RELATÓRIO GERAL DE ALUGUÉIS — LUNAR SYSTEM ©* 🌙\n\n`;
        for (const [gJid, info] of groups) {
          const meta = await sock.groupMetadata(gJid).catch(() => ({ subject: 'Grupo Desconhecido', participants: [] }));
          const inviteCode = await sock.groupInviteCode(gJid).catch(() => null);
          const inviteLink = inviteCode ? `https://chat.whatsapp.com/${inviteCode}` : 'Link indisponível';
          
          const isActive = info.expireAt > Date.now();
          const statusText = isActive ? '🟢 Ativo' : '🔴 Vencido';
          const remainingTime = isActive 
            ? `${Math.ceil((info.expireAt - Date.now()) / (1000 * 60 * 60 * 24))} dia(s) restante(s)` 
            : 'Expirado';

          report += `🏢 *Nome:* ${meta.subject}\n` +
            `👥 *Membros:* ${meta.participants.length}\n` +
            `📌 *Status:* ${statusText} (${remainingTime})\n` +
            `🔗 *Link:* ${inviteLink}\n` +
            `──────────────────────────\n`;
        }
        await safeSendMessage(sock, from, { text: report }, { quoted: msg });
        continue;
      }

      if (command === '/gerarpagamento' && isOwner) {
        ownerInteractiveSessions.set(senderJid, { step: 'GERAR_PAGAMENTO_VALOR' });
        await safeSendMessage(sock, from, { text: "🌙 Digite o valor em Reais (ex: 15.00) para gerar o PIX:" }, { quoted: msg });
        continue;
      }

      if (command === '/saldo' && isOwner) {
        try {
          const bal = await purincash.getWalletBalance();
          await safeSendMessage(sock, from, { text: `💼 *SALDO CARTEIRA LUNAR*\n\n💰 Líquido: R$ ${bal.formatted}` }, { quoted: msg });
        } catch (e) {
          await safeSendMessage(sock, from, { text: `❌ Erro: ${e.message}` }, { quoted: msg });
        }
        continue;
      }

      if (command === '/sacar' && isOwner) {
        ownerInteractiveSessions.set(senderJid, { step: 'SACAR_PIX_KEY' });
        await safeSendMessage(sock, from, { text: "🌙 Envie a Chave PIX para onde deseja transferir todo o saldo:" }, { quoted: msg });
        continue;
      }

      if (command === '/pagar' && isOwner) {
        ownerInteractiveSessions.set(senderJid, { step: 'PAGAR_PIX_KEY' });
        await safeSendMessage(sock, from, { text: "🌙 Envie a Chave PIX de destino:" }, { quoted: msg });
        continue;
      }

      if (command === '/blockbot' && isOwner) {
        const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
        if (!mentioned) {
          await safeSendMessage(sock, from, { text: "⚠️ Marque o usuário com `@mencao` para bloquear." }, { quoted: msg });
          continue;
        }
        if (!db.blacklistedUsers.includes(mentioned)) db.blacklistedUsers.push(mentioned);
        saveDatabase(db);
        await safeSendMessage(sock, from, { text: `✅ Usuário adicionado à lista negra com sucesso!` }, { quoted: msg });
        continue;
      }

      if (command === '/rmblockbot' && isOwner) {
        const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
        if (!mentioned) {
          await safeSendMessage(sock, from, { text: "⚠️ Marque o usuário com `@mencao` para remover." }, { quoted: msg });
          continue;
        }
        db.blacklistedUsers = db.blacklistedUsers.filter(j => j !== mentioned);
        saveDatabase(db);
        await safeSendMessage(sock, from, { text: `✅ Usuário removido da lista negra!` }, { quoted: msg });
        continue;
      }

      if (command === '/addnewcomando' && isOwner) {
        ownerInteractiveSessions.set(senderJid, { step: 'ADD_CMD_NAME' });
        await safeSendMessage(sock, from, { text: "🌙 Digite o nome do comando (sem a barra `/`):" }, { quoted: msg });
        continue;
      }

      if (command === '/ang' && isOwner) {
        ownerInteractiveSessions.set(senderJid, { step: 'BROADCAST_TEXT' });
        await safeSendMessage(sock, from, { text: "🌙 Envie o texto do comunicado global para todos os grupos:" }, { quoted: msg });
        continue;
      }

      const isAdminCommand = ['/ban', '/kick', '/promover', '/rebaixar', '/gp', '/gptime', '/welcome', '/saida', '/mute', '/unmute', '/mutetemp', '/listmutados', '/jogos', '/modoparceria', '/addparceria', '/rmparceria', '/antilink1', '/antilink2', '/antilinkgeral', '/antispam', '/limparchat', '/tagall'].includes(command);
      if (isAdminCommand && isGroup) {
        const groupMetadata = await sock.groupMetadata(from).catch(() => null);
        const participants = groupMetadata?.participants || [];
        const senderParticipant = participants.find(p => p.id === senderJid);
        const isSenderAdmin = senderParticipant?.admin === 'admin' || senderParticipant?.admin === 'superadmin';

        if (!isSenderAdmin && !isOwner) {
          await safeSendMessage(sock, from, { text: "⚠️ Apenas administradores do grupo podem usar este comando!" }, { quoted: msg });
          continue;
        }

        const targetUser = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || msg.message.extendedTextMessage?.contextInfo?.participant;

        if (command === '/ban' || command === '/kick') {
          if (!targetUser) {
            await safeSendMessage(sock, from, { text: "⚠️ Marque ou responda o usuário que deseja banir." }, { quoted: msg });
            continue;
          }
          await sock.groupParticipantsUpdate(from, [targetUser], 'remove');
          await safeSendMessage(sock, from, { text: `🛡️ @${senderJid.split('@')[0]} baniu o usuário @${targetUser.split('@')[0]} do grupo.`, mentions: [senderJid, targetUser] });
          continue;
        }

        if (command === '/promover') {
          if (!targetUser) {
            await safeSendMessage(sock, from, { text: "⚠️ Marque o usuário que deseja promover." }, { quoted: msg });
            continue;
          }
          await sock.groupParticipantsUpdate(from, [targetUser], 'promote');
          await safeSendMessage(sock, from, { text: `👑 @${senderJid.split('@')[0]} promoveu @${targetUser.split('@')[0]} a admin do grupo!`, mentions: [senderJid, targetUser] });
          continue;
        }

        if (command === '/rebaixar') {
          if (!targetUser) {
            await safeSendMessage(sock, from, { text: "⚠️ Marque o admin que deseja rebaixar." }, { quoted: msg });
            continue;
          }
          await sock.groupParticipantsUpdate(from, [targetUser], 'demote');
          await safeSendMessage(sock, from, { text: `🛡️ @${senderJid.split('@')[0]} rebaixou @${targetUser.split('@')[0]} a membro.`, mentions: [senderJid, targetUser] });
          continue;
        }

        if (command === '/gp') {
          const action = args[0]?.toLowerCase();
          if (action === 'a') {
            await sock.groupSettingUpdate(from, 'not_announcement');
            await safeSendMessage(sock, from, { text: `🔓 Grupo aberto para todos os membros por @${senderJid.split('@')[0]}!`, mentions: [senderJid] });
          } else if (action === 'f') {
            await sock.groupSettingUpdate(from, 'announcement');
            await safeSendMessage(sock, from, { text: `🔒 Grupo fechado apenas para administradores por @${senderJid.split('@')[0]}!`, mentions: [senderJid] });
          }
          continue;
        }

        if (command === '/jogos') {
          if (!db.groupSettings[from]) db.groupSettings[from] = {};
          db.groupSettings[from].jogos = args[0]?.toLowerCase() === 'on';
          saveDatabase(db);
          await safeSendMessage(sock, from, { text: `🎮 Modo de Jogos e Apostas está agora: *${args[0]?.toUpperCase()}*` });
          continue;
        }

        if (command === '/gptime') {
          const openTime = args[0];
          const closeTime = args[1];
          if (!openTime || !closeTime) {
            await safeSendMessage(sock, from, { text: "⚠️ Uso correto: `/gptime 07:00 22:00`" }, { quoted: msg });
            continue;
          }
          if (!db.groupSchedules) db.groupSchedules = {};
          db.groupSchedules[from] = { open: openTime, close: closeTime };
          saveDatabase(db);
          await safeSendMessage(sock, from, { text: `⏰ *Agendamento configurado com sucesso!*\n🔓 Abertura: ${openTime}\n🔒 Fechamento: ${closeTime}` });
          continue;
        }

        if (command === '/welcome') {
          if (!db.groupSettings[from]) db.groupSettings[from] = {};
          db.groupSettings[from].welcome = args[0]?.toLowerCase() === 'on';
          saveDatabase(db);
          await safeSendMessage(sock, from, { text: `✨ Mensagem de Boas-Vindas está agora: *${args[0]?.toUpperCase()}*` });
          continue;
        }

        if (command === '/saida') {
          if (!db.groupSettings[from]) db.groupSettings[from] = {};
          db.groupSettings[from].saida = args[0]?.toLowerCase() === 'on';
          saveDatabase(db);
          await safeSendMessage(sock, from, { text: `💧 Mensagem de Saída está agora: *${args[0]?.toUpperCase()}*` });
          continue;
        }

        if (command === '/mute') {
          if (!targetUser) {
            await safeSendMessage(sock, from, { text: "⚠️ Marque o usuário que deseja mutar: `/mute @mencao`" }, { quoted: msg });
            continue;
          }
          if (!db.mutedUsers[from]) db.mutedUsers[from] = {};
          db.mutedUsers[from][targetUser] = { expiresAt: null };
          saveDatabase(db);
          await safeSendMessage(sock, from, { text: `🔇 Usuário @${targetUser.split('@')[0]} foi silenciado por tempo indeterminado!`, mentions: [targetUser] });
          continue;
        }

        if (command === '/unmute') {
          if (!targetUser) {
            await safeSendMessage(sock, from, { text: "⚠️ Marque o usuário que deseja desmutar: `/unmute @mencao`" }, { quoted: msg });
            continue;
          }
          if (db.mutedUsers[from]?.[targetUser]) {
            delete db.mutedUsers[from][targetUser];
            saveDatabase(db);
            await safeSendMessage(sock, from, { text: `🔊 Usuário @${targetUser.split('@')[0]} foi desmutado com sucesso!`, mentions: [targetUser] });
          } else {
            await safeSendMessage(sock, from, { text: "⚠️ Este usuário não está silenciado." });
          }
          continue;
        }

        if (command === '/mutetemp') {
          if (!targetUser) {
            await safeSendMessage(sock, from, { text: "⚠️ Uso correto: `/mutetemp @mencao 2h` ou `/mutetemp @mencao 1d`" }, { quoted: msg });
            continue;
          }
          const durationMs = parseMuteDuration(args[1]);
          if (!durationMs) {
            await safeSendMessage(sock, from, { text: "⚠️ Duração inválida! Use formato de horas (ex: `1h` a `24h`) ou dias (ex: `1d` a `366d`)." }, { quoted: msg });
            continue;
          }

          if (!db.mutedUsers[from]) db.mutedUsers[from] = {};
          db.mutedUsers[from][targetUser] = { expiresAt: Date.now() + durationMs };
          saveDatabase(db);
          await safeSendMessage(sock, from, { text: `🔇 Usuário @${targetUser.split('@')[0]} foi silenciado por *${args[1]}*!`, mentions: [targetUser] });
          continue;
        }

        if (command === '/listmutados') {
          const mutes = db.mutedUsers[from] || {};
          const entries = Object.entries(mutes);
          if (entries.length === 0) {
            await safeSendMessage(sock, from, { text: "🔊 Não há usuários silenciados neste grupo no momento." }, { quoted: msg });
            continue;
          }

          let muteListText = `🔇 *LISTA DE USUÁRIOS SILENCIADOS* 🌙\n\n`;
          const mentions = [];
          const now = Date.now();

          for (const [uJid, data] of entries) {
            let timeInfo = "Indeterminado";
            if (data.expiresAt) {
              const diffMs = data.expiresAt - now;
              const diffHours = Math.ceil(diffMs / (1000 * 60 * 60));
              timeInfo = diffHours > 24 ? `${Math.ceil(diffHours / 24)} dia(s)` : `${diffHours} hora(s)`;
            }
            muteListText += `👤 @${uJid.split('@')[0]}\n⏳ Tempo restante: *${timeInfo}*\n──────────────────────────\n`;
            mentions.push(uJid);
          }
          await safeSendMessage(sock, from, { text: muteListText, mentions }, { quoted: msg });
          continue;
        }

        if (command === '/modoparceria') {
          if (!db.groupSettings[from]) db.groupSettings[from] = {};
          db.groupSettings[from].modoparceria = args[0]?.toLowerCase() === 'on';
          saveDatabase(db);
          await safeSendMessage(sock, from, { text: `🤝 Modo Parceria está agora: *${args[0]?.toUpperCase()}*` });
          continue;
        }

        if (command === '/addparceria') {
          if (!targetUser) {
            await safeSendMessage(sock, from, { text: "⚠️ Marque o usuário: `/addparceria @mencao <quantia>`" }, { quoted: msg });
            continue;
          }
          const quantia = parseInt(args[1]);
          if (isNaN(quantia) || quantia <= 0) {
            await safeSendMessage(sock, from, { text: "⚠️ Informe uma quantia válida de links diários." }, { quoted: msg });
            continue;
          }
          if (!db.partners[from]) db.partners[from] = {};
          db.partners[from][targetUser] = {
            limit: quantia,
            used: 0,
            resetDate: new Date().toISOString().split('T')[0],
            joinedAt: Date.now()
          };
          saveDatabase(db);
          await safeSendMessage(sock, from, { text: `✅ Parceiro @${targetUser.split('@')[0]} adicionado com cota de *${quantia} links diários*!`, mentions: [targetUser] });
          continue;
        }

        if (command === '/rmparceria') {
          if (!targetUser) {
            await safeSendMessage(sock, from, { text: "⚠️ Marque o usuário que deseja remover dos parceiros." }, { quoted: msg });
            continue;
          }
          if (db.partners[from] && db.partners[from][targetUser]) {
            delete db.partners[from][targetUser];
            saveDatabase(db);
            await safeSendMessage(sock, from, { text: `🚫 Parceiro @${targetUser.split('@')[0]} removido com sucesso!`, mentions: [targetUser] });
          } else {
            await safeSendMessage(sock, from, { text: "⚠️ Este usuário não consta na lista de parceiros." });
          }
          continue;
        }

        if (command === '/antilink1') {
          if (!db.groupSettings[from]) db.groupSettings[from] = {};
          db.groupSettings[from].antilink1 = args[0]?.toLowerCase() === 'on';
          saveDatabase(db);
          await safeSendMessage(sock, from, { text: `⚙️ Antilink 1 está agora: *${args[0]?.toUpperCase()}*` });
          continue;
        }

        if (command === '/antilink2') {
          if (!db.groupSettings[from]) db.groupSettings[from] = {};
          db.groupSettings[from].antilink2 = args[0]?.toLowerCase() === 'on';
          saveDatabase(db);
          await safeSendMessage(sock, from, { text: `⚙️ Antilink 2 (Com Ban) está agora: *${args[0]?.toUpperCase()}*` });
          continue;
        }

        if (command === '/antilinkgeral') {
          if (!db.groupSettings[from]) db.groupSettings[from] = {};
          db.groupSettings[from].antilinkgeral = args[0]?.toLowerCase() === 'on';
          saveDatabase(db);
          await safeSendMessage(sock, from, { text: `⚙️ Antilink Geral está agora: *${args[0]?.toUpperCase()}*` });
          continue;
        }

        if (command === '/antispam') {
          if (!db.groupSettings[from]) db.groupSettings[from] = {};
          db.groupSettings[from].antispam = args[0]?.toLowerCase() === 'on';
          saveDatabase(db);
          await safeSendMessage(sock, from, { text: `⚙️ Anti-Spam está agora: *${args[0]?.toUpperCase()}*` });
          continue;
        }

        if (command === '/limparchat') {
          const blankLines = "\n".repeat(30);
          await safeSendMessage(sock, from, { text: blankLines + "🧹 *Chat limpo por administração!* " + blankLines });
          continue;
        }

        if (command === '/tagall') {
          const mentions = participants.map(p => p.id);
          let tagText = `📢 *MARCAÇÃO GERAL DO GRUPO*\n\n`;
          for (const p of participants) {
            tagText += `@${p.id.split('@')[0]} `;
          }
          await safeSendMessage(sock, from, { text: tagText, mentions });
          continue;
        }
      }

      if (command === '/menuparceria') {
        const parceriaText = `🤖 LUNAR BOT | LUNAR SYSTEM ©\n\n` +
          `❖ 🤝 SISTEMA DE PARCERIAS\n` +
          `› /menuparceria - Exibe este painel de parcerias\n` +
          `› /modoparceria [on/off] - Ativa o modo de links\n` +
          `› /addparceria @membro <qtd> - Adiciona cota diária\n` +
          `› /rmparceria @membro - Remove o parceiro\n` +
          `› /listparceria - Lista parceiros oficiais ativos\n\n` +
          `✦ LUNAR SYSTEM © ✨`;

        await safeSendMessage(sock, from, { text: parceriaText }, { quoted: msg });
        continue;
      }

      if (command === '/listparceria') {
        const groupPartners = db.partners[from] || {};
        const entries = Object.entries(groupPartners);

        if (entries.length === 0) {
          await safeSendMessage(sock, from, { text: "🤝 Não há parceiros cadastrados neste grupo no momento." }, { quoted: msg });
          continue;
        }

        let listText = `🤝 *LISTA DE PARCEIROS OFICIAIS* 🌙\n\n`;
        const mentions = [];

        for (const [userJid, data] of entries) {
          const daysActive = Math.floor((Date.now() - (data.joinedAt || Date.now())) / (1000 * 60 * 60 * 24));
          listText += `👤 @${userJid.split('@')[0]}\n` +
            `📊 Quantidade de links diários: *${data.limit}*\n` +
            `⏳ Parceiro há: *${daysActive} dia(s)*\n` +
            `──────────────────────────\n`;
          mentions.push(userJid);
        }

        await safeSendMessage(sock, from, { text: listText, mentions }, { quoted: msg });
        continue;
      }

      const isGameCommand = ['/menujogos', '/carteira', '/dados', '/dardo', '/velha', '/slots'].includes(command);
      if (isGameCommand && isGroup) {
        const settings = db.groupSettings[from] || {};
        if (!settings.jogos && !isOwner) {
          await safeSendMessage(sock, from, { text: "🎮 O modo de jogos está desligado neste grupo! Peça a um administrador para ativar com `/jogos on`." }, { quoted: msg });
          continue;
        }

        if (command === '/menujogos') {
          const gamesMenu = `🤖 LUNAR BOT | LUNAR SYSTEM ©\n\n` +
            `❖ 🎮 CASSINO & JOGOS\n` +
            `› /menujogos - Exibe o painel de jogos\n` +
            `› /carteira - Consulta seus Lunar Cents (¢)\n` +
            `› /dados <valor> - Roda o dado de sorte (1 a 6x)\n` +
            `› /dardo <valor> - Tiro ao alvo de precisão (2x)\n` +
            `› /velha @rival <valor> - Duelo PvP no Jogo da Velha\n` +
            `› /slots <valor> - Caça-níqueis com jackpots até 10x\n\n` +
            `✦ LUNAR SYSTEM © ✨`;

          await safeSendMessage(sock, from, { text: gamesMenu }, { quoted: msg });
          continue;
        }

        if (command === '/carteira') {
          const balance = getBalance(db, senderJid);
          await safeSendMessage(sock, from, { text: `💳 *CARTEIRA LUNAR*\n\n👤 *Jogador:* @${userNumber}\n💰 *Saldo:* ${balance}¢`, mentions: [senderJid] }, { quoted: msg });
          continue;
        }

        if (command === '/dados') {
          const bet = parseInt(args[0]);
          const currentBal = getBalance(db, senderJid);

          if (isNaN(bet) || bet <= 0) {
            await safeSendMessage(sock, from, { text: "⚠️ Digite um valor válido para apostar: `/dados 5`" }, { quoted: msg });
            continue;
          }
          if (bet > currentBal) {
            await safeSendMessage(sock, from, { text: `⚠️ Saldo insuficiente! Seu saldo atual é de *${currentBal}¢*.` }, { quoted: msg });
            continue;
          }

          const roll = Math.floor(Math.random() * 6) + 1;

          if (roll === 1) {
            updateBalance(db, senderJid, -bet);
            await safeSendMessage(sock, from, { text: `🎲 *O Dado Rolou... e caiu em [ 1 ]!* 💥\n\n❌ Poxa, você tirou 1 e perdeu sua aposta de *${bet}¢*!` }, { quoted: msg });
          } else {
            const rawWin = bet * roll;
            const houseTax = calculateHouseTax(rawWin);
            const netWin = rawWin - houseTax - bet;
            updateBalance(db, senderJid, netWin);

            await safeSendMessage(sock, from, { text: `🎲 *O Dado Rolou... e caiu em [ ${roll} ]!* 🎉\n\n✨ Você multiplicou por *${roll}x*!\n💰 *Lucro Líquido:* +${netWin}¢ (Taxa da casa: ${houseTax}¢)` }, { quoted: msg });
          }
          continue;
        }

        if (command === '/dardo') {
          const bet = parseInt(args[0]);
          const currentBal = getBalance(db, senderJid);

          if (isNaN(bet) || bet <= 0) {
            await safeSendMessage(sock, from, { text: "⚠️ Digite um valor válido para apostar: `/dardo 5`" }, { quoted: msg });
            continue;
          }
          if (bet > currentBal) {
            await safeSendMessage(sock, from, { text: `⚠️ Saldo insuficiente! Seu saldo atual é de *${currentBal}¢*.` }, { quoted: msg });
            continue;
          }

          const hit = Math.random() <= 0.40;

          if (hit) {
            const rawWin = bet * 2;
            const houseTax = calculateHouseTax(rawWin);
            const netWin = rawWin - houseTax - bet;
            updateBalance(db, senderJid, netWin);

            await safeSendMessage(sock, from, { text: `🎯 *BULLSEYE!* Você acertou em cheio no centro do alvo!\n\n✨ Multiplicador *2x* ativado!\n💰 *Lucro Líquido:* +${netWin}¢ (Taxa da casa: ${houseTax}¢)` }, { quoted: msg });
          } else {
            updateBalance(db, senderJid, -bet);
            await safeSendMessage(sock, from, { text: `🎯 *O dardo voou longe...* e errou o alvo! 💥\n\n❌ Você perdeu sua aposta de *${bet}¢*!` }, { quoted: msg });
          }
          continue;
        }

        if (command === '/velha') {
          const rivalJid = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
          const bet = parseInt(args[1]);

          if (!rivalJid || isNaN(bet) || bet <= 0) {
            await safeSendMessage(sock, from, { text: "⚠️ Uso correto: `/velha @rival <valor>`" }, { quoted: msg });
            continue;
          }

          if (tictactoeGames.has(from)) {
            await safeSendMessage(sock, from, { text: "⚠️ Já existe uma partida de Jogo da Velha acontecendo neste grupo! Aguarde terminar." }, { quoted: msg });
            continue;
          }

          const challengerBal = getBalance(db, senderJid);
          const rivalBal = getBalance(db, rivalJid);

          if (challengerBal < bet) {
            await safeSendMessage(sock, from, { text: `⚠️ Você não tem saldo suficiente para esta aposta! Seu saldo: *${challengerBal}¢*.` }, { quoted: msg });
            continue;
          }
          if (rivalBal < bet) {
            await safeSendMessage(sock, from, { text: `⚠️ O desafiado @${rivalJid.split('@')[0]} não possui saldo suficiente (*${rivalBal}¢*) para apostar *${bet}¢*!`, mentions: [rivalJid] }, { quoted: msg });
            continue;
          }

          updateBalance(db, senderJid, -bet);
          updateBalance(db, rivalJid, -bet);

          tictactoeGames.set(from, {
            player1: senderJid,
            player2: rivalJid,
            turn: senderJid,
            bet: bet,
            board: [' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ']
          });

          const boardDisplay = `🎮 *DUELO DE JOGO DA VELHA INICIADO!*\n\n` +
            `👤 *Desafiante:* @${senderJid.split('@')[0]} (❌)\n` +
            `👤 *Rival:* @${rivalJid.split('@')[0]} (⭕)\n` +
            `💰 *Aposta de Cada:* ${bet}¢ (Pote Total: ${bet * 2}¢)\n\n` +
            `1️⃣   | 2️⃣   | 3️⃣  \n` +
            `4️⃣   | 5️⃣   | 6️⃣  \n` +
            `7️⃣   | 8️⃣   | 9️⃣  \n\n` +
            `👉 Vez do jogador: @${senderJid.split('@')[0]} (Responda apenas com o número da casa de 1 a 9)`;

          await safeSendMessage(sock, from, { text: boardDisplay, mentions: [senderJid, rivalJid] });
          continue;
        }

        if (command === '/slots') {
          const bet = parseInt(args[0]);
          const currentBal = getBalance(db, senderJid);

          if (isNaN(bet) || bet <= 0) {
            await safeSendMessage(sock, from, { text: "⚠️ Digite um valor válido para apostar: `/slots 10`" }, { quoted: msg });
            continue;
          }
          if (bet > currentBal) {
            await safeSendMessage(sock, from, { text: `⚠️ Saldo insuficiente! Seu saldo atual é de *${currentBal}¢*.` }, { quoted: msg });
            continue;
          }

          const symbols = ['🥐', '🪐', '🚀', '💎', '🌙'];
          const rand = Math.random();
          let s1, s2, s3, multiplier = 0;

          if (rand < 0.03) {
            s1 = '🌙'; s2 = '🌙'; s3 = '🌙';
            multiplier = 10;
          } else if (rand < 0.10) {
            s1 = '💎'; s2 = '💎'; s3 = '💎';
            multiplier = 5;
          } else if (rand < 0.22) {
            s1 = '🚀'; s2 = '🚀'; s3 = '🚀';
            multiplier = 3;
          } else if (rand < 0.40) {
            s1 = '🪐'; s2 = '🪐'; s3 = '🪐';
            multiplier = 2;
          } else {
            s1 = symbols[Math.floor(Math.random() * symbols.length)];
            s2 = symbols[Math.floor(Math.random() * symbols.length)];
            s3 = symbols[Math.floor(Math.random() * symbols.length)];
            if (s1 === s2 && s2 === s3) s3 = symbols[(symbols.indexOf(s3) + 1) % symbols.length];
            multiplier = 0;
          }

          const slotDisplay = `🎰 *CAÇA-NÍQUEIS LUNAR NEON* 🎰\n\n` +
            `[ ${s1} | ${s2} | ${s3} ]\n\n`;

          if (multiplier > 0) {
            const rawWin = bet * multiplier;
            const houseTax = calculateHouseTax(rawWin);
            const netWin = rawWin - houseTax - bet;
            updateBalance(db, senderJid, netWin);

            const jackpotHeader = multiplier === 10 ? "🚨 *MEGA JACKPOT 10X DETONADO!* 🚨" : "🎉 *GRANDE VITÓRIA!*";
            await safeSendMessage(sock, from, { text: `${slotDisplay}${jackpotHeader}\n\n✨ Multiplicador: *${multiplier}x*\n💰 *Lucro Líquido:* +${netWin}¢ (Taxa da casa: ${houseTax}¢)` }, { quoted: msg });
          } else {
            updateBalance(db, senderJid, -bet);
            await safeSendMessage(sock, from, { text: `${slotDisplay}💥 Poxa, os símbolos não alinharam!\n❌ Você perdeu sua aposta de *${bet}¢*!` }, { quoted: msg });
          }
          continue;
        }
      }

      if (command === '/menualuguel' || command === '/infoaluguel') {
        const groupExpire = db.rentedGroups[from]?.expireAt;
        const timeRemaining = groupExpire && groupExpire > Date.now() 
          ? `⏳ *Status:* Ativo (Expira em ${Math.ceil((groupExpire - Date.now()) / (1000 * 60 * 60 * 24))} dias)` 
          : `❌ *Status:* Expirado ou Sem Aluguel Ativo`;

        const infoText = `🤖 LUNAR BOT | LUNAR SYSTEM ©\n\n` +
          `❖ 💳 PLANOS DE ALUGUEL\n` +
          `› /menualuguel - Verifica o status do grupo\n` +
          `› /aluguel - Exibe a tabela de preços e planos\n` +
          `› /alugar <plano> - Gera PIX de ativação automática\n\n` +
          `📌 ${timeRemaining}\n\n` +
          `✦ LUNAR SYSTEM © ✨`;

        await safeSendMessage(sock, from, { text: infoText }, { quoted: msg });
        continue;
      }

      if (command === '/aluguel') {
        let tableText = `🌙 *TABELA OFICIAL DE ALUGUEL — LUNAR SYSTEM ©* 🌙\n\n` +
          `Garanta automação profissional e segurança para seu grupo!\n\n`;

        for (const [key, plan] of Object.entries(db.rentalPlans)) {
          tableText += `💎 *Plano:* ${plan.name}\n` +
            `⏱️ *Duração:* ${plan.days} dia(s)\n` +
            `💵 *Valor:* R$ ${plan.price.toFixed(2).replace('.', ',')}\n` +
            `👉 *Comando:* \`/alugar ${key}\`\n\n`;
        }

        await safeSendMessage(sock, from, { text: tableText }, { quoted: msg });
        continue;
      }

      if (command === '/alugar') {
        const planKey = args[0]?.toLowerCase();
        const plan = db.rentalPlans[planKey];

        if (!plan) {
          await safeSendMessage(sock, from, { text: "⚠️ Plano inválido! Digite `/aluguel` para ver os planos disponíveis." }, { quoted: msg });
          continue;
        }

        try {
          await safeSendMessage(sock, from, { text: `⏳ Gerando PIX automático de R$ ${plan.price.toFixed(2)} para o plano *${plan.name}*...` }, { quoted: msg });

          const charge = await purincash.createPixCharge(plan.price, `Aluguel Lunar - ${plan.name}`);
          const chargeId = charge.id || charge.chargeId;
          const pixCode = extractPixString(charge);

          if (!pixCode) {
            await safeSendMessage(sock, from, { text: `❌ Não foi possível extrair o código PIX da resposta da API.` }, { quoted: msg });
            continue;
          }

          const qrBuffer = await generateQrBuffer(pixCode);
          if (qrBuffer) {
            await safeSendMessage(sock, from, { 
              image: qrBuffer, 
              caption: `✅ *PIX GERADO COM SUCESSO!*\n\n💎 *Plano:* ${plan.name}\n💵 *Valor:* R$ ${plan.price.toFixed(2)}\n\n📌 *Escaneie o QR Code acima com o aplicativo do seu banco ou utilize o Copia e Cola enviado a seguir:*` 
            }, { quoted: msg });
          }

          await safeSendMessage(sock, from, { text: pixCode }, { quoted: msg });

          purincash.monitorPayment(
            chargeId,
            async () => {
              const currentExpire = db.rentedGroups[from]?.expireAt || Date.now();
              const baseTime = currentExpire > Date.now() ? currentExpire : Date.now();
              const newExpire = baseTime + (plan.days * 24 * 60 * 60 * 1000);

              db.rentedGroups[from] = { expireAt: newExpire };
              saveDatabase(db);

              await safeSendMessage(sock, from, { 
                text: `🎉 *PAGAMENTO CONFIRMADO COM SUCESSO!*\n\n✨ O aluguel do grupo foi estendido em *+${plan.days} dia(s)*!\nObrigado por assinar a Lunar System ©.` 
              });
            },
            async () => {
              await safeSendMessage(sock, from, { text: `⏱️ O tempo para pagamento da cobrança \`${chargeId}\` expirou.` });
            }
          );

        } catch (e) {
          await safeSendMessage(sock, from, { text: `❌ Erro ao gerar pagamento: ${e.message}` }, { quoted: msg });
        }
        continue;
      }

      if (command === '/menu') {
        const menuText = `🤖 LUNAR BOT | LUNAR SYSTEM ©\n\n` +
          `❖ 📋 MENUS PRINCIPAIS\n` +
          `› /menualuguel - Painel e status de aluguel\n` +
          `› /aluguel - Tabela de preços e planos\n` +
          `› /menuparceria - Sistema de parcerias oficiais\n` +
          `› /menujogos - Cassino e jogos de aposta\n` +
          `› /menuadm - Painel de administração do grupo\n` +
          `› /owner ou /dono - Contato do criador\n` +
          `› /ping - Verifica latência do bot\n\n` +
          `✦ LUNAR SYSTEM © ✨`;

        await safeSendMessage(sock, from, { text: menuText }, { quoted: msg });
        continue;
      }

      if (command === '/ping') {
        const start = Date.now();
        await safeSendMessage(sock, from, { text: `🏓 Pong! Latência: ${Date.now() - start}ms | Lunar System 100% Operacional.` }, { quoted: msg });
        continue;
      }

      if (command === '/owner' || command === '/dono') {
        const ownerNum = FIXED_OWNER_NUMBER;
        const ownerName = db.ownerName || "MONTANHA DEV";

        const vcard = 'BEGIN:VCARD\n' +
          'VERSION:3.0\n' +
          `FN:${ownerName}\n` +
          `ORG:${config.COMPANY_NAME};\n` +
          `TEL;type=CELL;type=VOICE;waid=${ownerNum}:+${ownerNum}\n` +
          'END:VCARD';

        await safeSendMessage(sock, from, { contacts: { displayName: ownerName, contacts: [{ vcard }] } }, { quoted: msg });
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
