const { 
  Client, 
  GatewayIntentBits, 
  REST, 
  Routes, 
  SlashCommandBuilder, 
  PermissionFlagsBits, 
  EmbedBuilder 
} = require('discord.js');
const express = require('express');

// --- KEEP-ALIVE SERVER FOR RENDER / HOSTING ---
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Nebula Bot & AI System is active 24/7!');
});

app.listen(port, () => {
  console.log(`Web server running on port ${port}`);
});

// --- CONFIGURATION ---
const TARGET_CHANNEL_ID = process.env.TARGET_CHANNEL_ID;
const BOT_TOKEN = process.env.DISCORD_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const NEBULA_SERVER_URL = (process.env.NEBULA_SERVER_URL || 'http://212.180.120.172:3000').replace(/\/$/, '');
const NEBULA_OWNER_PASSWORD = process.env.NEBULA_OWNER_PASSWORD || 'nebula_owner_sec';

// Role IDs to assign with /give command
const ROLE_ID_1 = '1527450826698920026';
const ROLE_ID_2 = '1527450854209224835';

// --- GROQ AI CHAT HELPER ---
async function askGroqAI(prompt) {
  if (!GROQ_API_KEY) {
    return 'Groq API Key tanımlanmamış. Lütfen GROQ_API_KEY ortam değişkenini ayarlayın.';
  }

  const modelsToTry = [
    GROQ_MODEL,
    'llama-3.3-70b-versatile',
    'llama-3.1-70b-versatile',
    'llama-3.1-8b-instant',
    'mixtral-8x7b-32768'
  ];

  // Remove duplicates while preserving order
  const uniqueModels = [...new Set(modelsToTry)];

  for (const model of uniqueModels) {
    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: model,
          messages: [
            {
              role: 'system',
              content: 'Sen yardımsever, samimi ve zeki bir Discord asistanısın.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          max_tokens: 1024,
          temperature: 0.7
        }),
        signal: AbortSignal.timeout(10000)
      });

      if (response.ok) {
        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content;
        if (content) return content;
      } else {
        const errText = await response.text();
        console.warn(`Groq model ${model} error:`, errText);
      }
    } catch (e) {
      console.warn(`Groq request failed for ${model}:`, e.message);
    }
  }

  return 'Üzgünüm, şu anda yapay zeka yanıt veremiyor. Lütfen daha sonra tekrar deneyin.';
}

// --- NEBULA API HELPERS ---

/**
 * Searches vending machine listings from Nebula server
 */
async function searchNebulaVends(query) {
  try {
    const res = await fetch(`${NEBULA_SERVER_URL}/api/vends/search?query=${encodeURIComponent(query)}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000)
    });

    if (!res.ok) {
      // Fallback: try POST /api/vends/search
      const postRes = await fetch(`${NEBULA_SERVER_URL}/api/vends/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(5000)
      });
      if (postRes.ok) return await postRes.json();
      return { success: false, message: `Server error: HTTP ${res.status}` };
    }

    return await res.json();
  } catch (err) {
    console.error('Error fetching vend search from Nebula server:', err.message);
    return { success: false, message: `Sunucuya bağlanılamadı: ${err.message}` };
  }
}

/**
 * Updates or binds username to a given original license key
 */
async function updateNebulaKey(key, username) {
  const cleanKey = key.trim();
  const cleanUser = username.trim();

  // 1. Try modern /api/set_username endpoint
  try {
    const res = await fetch(`${NEBULA_SERVER_URL}/api/set_username`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: cleanKey, username: cleanUser }),
      signal: AbortSignal.timeout(5000)
    });

    if (res.ok) {
      const data = await res.json();
      return data;
    }
  } catch (e) {
    // Ignore and fallback below
  }

  // 2. Fallback: check key, unbind existing username if needed, then bind
  try {
    // Check if key exists in DB
    const keysRes = await fetch(`${NEBULA_SERVER_URL}/key_data_secret`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000)
    });

    if (keysRes.ok) {
      const allKeys = await keysRes.json();
      if (!allKeys || !allKeys[cleanKey]) {
        return { success: false, message: 'Bu lisans anahtarı veritabanında bulunamadı!' };
      }

      // Check if username is taken by another key
      for (const k in allKeys) {
        if (k !== cleanKey && allKeys[k].username && allKeys[k].username.toLowerCase() === cleanUser.toLowerCase()) {
          return { success: false, message: 'Bu kullanıcı adı zaten başka bir lisans anahtarına bağlı!' };
        }
      }
    }

    // Unbind existing user if any
    await fetch(`${NEBULA_SERVER_URL}/api/unbind`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: cleanKey, password: NEBULA_OWNER_PASSWORD }),
      signal: AbortSignal.timeout(5000)
    });

    // Bind new username
    const bindRes = await fetch(`${NEBULA_SERVER_URL}/api/bind`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: cleanKey, username: cleanUser }),
      signal: AbortSignal.timeout(5000)
    });

    if (bindRes.ok) {
      const bindData = await bindRes.json();
      return bindData;
    }

    return { success: false, message: 'Kullanıcı adı güncellenemedi.' };
  } catch (err) {
    console.error('Error updating key on Nebula server:', err.message);
    return { success: false, message: `Sunucu bağlantı hatası: ${err.message}` };
  }
}

/**
 * Creates Discord Embed for Vend Search results
 */
function createVendSearchEmbed(query, data) {
  if (!data || !data.success || !data.results || data.results.length === 0) {
    return new EmbedBuilder()
      .setColor(0xE74C3C)
      .setTitle(`🏪 Nebula Vend Arama: "${query}"`)
      .setDescription('❌ Bu eşyayı satan hiçbir vending makinesi bulunamadı.')
      .setFooter({ text: 'Nebula Proxy Vend Arama Sistemi' })
      .setTimestamp();
  }

  const results = data.results;
  const count = data.count || results.length;
  const avgPrice = data.avg_price_str || 'N/A';

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`🏪 Nebula Vend Arama Sonuçları`)
    .setDescription(`🔎 **Aranan Eşya:** \`${query}\`\n📊 **Ortalama Fiyat:** \`${avgPrice}\`\n📦 **Bulunan Toplam Makine:** \`${count}\` adet\n───────────────────────`)
    .setFooter({ text: `Nebula Proxy Vend Sistemi • Toplam ${count} sonuç` })
    .setTimestamp();

  // Show up to 10 cheapest listings
  const maxDisplay = Math.min(10, results.length);
  for (let i = 0; i < maxDisplay; i++) {
    const item = results[i];
    const pos = (item.x !== undefined && item.y !== undefined) ? `(X: ${item.x}, Y: ${item.y})` : '';
    const timeAgo = item.time_ago ? `• 🕒 ${item.time_ago}` : '';

    embed.addFields({
      name: `${i + 1}. 🌍 Dünya: ${item.world}`,
      value: `📦 **Eşya:** ${item.item_name || query}\n💰 **Fiyat:** \`${item.price_str || item.price}\` ${pos} ${timeAgo}`,
      inline: false
    });
  }

  if (results.length > maxDisplay) {
    embed.addFields({
      name: '➕ Daha Fazlası',
      value: `*... ve ${results.length - maxDisplay} adet daha dünya listelendi.*`,
      inline: false
    });
  }

  return embed;
}

// --- DISCORD CLIENT SETUP ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// Slash commands definition
const commands = [
  new SlashCommandBuilder()
    .setName('give')
    .setDescription('Kullanıcıya özel yetki rollerini atar')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption(option => 
      option.setName('target')
        .setDescription('Rol verilecek kullanıcı')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('key')
    .setDescription('Orijinal Nebula lisans anahtarınıza yeni bir Growtopia/Nebula kullanıcı adı bağlayın')
    .addStringOption(option =>
      option.setName('key')
        .setDescription('Orijinal Nebula Lisans Anahtarınız (Örn: Nebula-XXXXX veya TEST_KEY)')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('username')
        .setDescription('Bağlamak istediğiniz yeni Growtopia kullanıcı adınız')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('vend')
    .setDescription('Vending makinelerinde satılan Growtopia eşyalarını ve fiyatlarını arar')
    .addStringOption(option =>
      option.setName('item')
        .setDescription('Aramak istediğiniz eşyanın adı veya ID numarası (Örn: magplant, dirt, 242)')
        .setRequired(true)
    )
];

// Register slash commands
client.on('clientReady', async () => {
  console.log(`Bot logged in as ${client.user.tag}`);

  if (!BOT_TOKEN) {
    console.warn('WARNING: DISCORD_TOKEN is not defined in environment variables.');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  try {
    console.log('Registering application (/) commands...');
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log('Successfully registered application (/) commands.');
  } catch (error) {
    console.error('Failed to register slash commands:', error);
  }
});

// --- SLASH COMMAND HANDLER ---
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // 1. /give COMMAND
  if (interaction.commandName === 'give') {
    const targetMember = interaction.options.getMember('target');

    if (!targetMember) {
      return interaction.reply({ content: 'Kullanıcı bu sunucuda bulunamadı.', flags: 64 });
    }

    try {
      await targetMember.roles.add([ROLE_ID_1, ROLE_ID_2]);
      await interaction.reply({ 
        content: `Başarıyla ${targetMember.user.tag} kullanıcısına roller verildi!` 
      });
    } catch (err) {
      console.error('Failed to assign roles:', err);
      await interaction.reply({ 
        content: 'Rol atanırken hata oluştu. Yetkileri kontrol edin.', 
        flags: 64 
      });
    }
  }

  // 2. /key COMMAND (Key & Username Bind/Change)
  if (interaction.commandName === 'key') {
    // Reply ephemerally so the user's license key remains completely private
    await interaction.deferReply({ flags: 64 });

    const key = interaction.options.getString('key').trim();
    const username = interaction.options.getString('username').trim();

    if (username.length < 3 || username.length > 24) {
      return interaction.editReply({ 
        content: '❌ **Hata:** Kullanıcı adı 3 ile 24 karakter arasında olmalıdır.' 
      });
    }

    const res = await updateNebulaKey(key, username);

    if (res && res.success) {
      const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('✅ Nebula Lisans Anahtarı Güncellendi')
        .setDescription('Lisans anahtarınız başarıyla yeni kullanıcı adınıza bağlandı!')
        .addFields(
          { name: '🔑 Lisans Anahtarı', value: `\`||${key}||\``, inline: true },
          { name: '👤 Bağlanan Kullanıcı Adı', value: `\`${username}\``, inline: true }
        )
        .setFooter({ text: 'Nebula Proxy Lisanslama Sistemi' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } else {
      const errMsg = res?.message || 'Lisans anahtarı güncellenemedi.';
      const embed = new EmbedBuilder()
        .setColor(0xE74C3C)
        .setTitle('❌ İşlem Başarısız')
        .setDescription(`**Hata:** ${errMsg}`)
        .setFooter({ text: 'Nebula Proxy Lisanslama Sistemi' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    }
  }

  // 3. /vend COMMAND (Slash Command Search)
  if (interaction.commandName === 'vend') {
    await interaction.deferReply();
    const itemQuery = interaction.options.getString('item').trim();

    const data = await searchNebulaVends(itemQuery);
    const embed = createVendSearchEmbed(itemQuery, data);
    await interaction.editReply({ embeds: [embed] });
  }
});

// --- MESSAGE HANDLER (!vend, TRAP & AI) ---
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // 1. TRAP CHANNEL LOGIC
  if (TARGET_CHANNEL_ID && message.channel.id === TARGET_CHANNEL_ID) {
    try {
      await message.guild.members.ban(message.author.id, { 
        reason: 'Triggered the honeypot channel.' 
      });
      if (message.deletable) await message.delete();
      console.log(`Banned ${message.author.tag} in trap channel.`);
    } catch (err) {
      console.error('Ban error:', err);
    }
    return;
  }

  const content = message.content.trim();

  // 2. !vend <item_adi> COMMAND
  if (content.toLowerCase().startsWith('!vend')) {
    const itemQuery = content.slice(5).trim();

    if (!itemQuery) {
      return message.reply('ℹ️ **Kullanım:** `!vend <item_adi veya ID>`\n*Örnek:* `!vend magplant` veya `!vend dirt`');
    }

    try {
      await message.channel.sendTyping();
      const data = await searchNebulaVends(itemQuery);
      const embed = createVendSearchEmbed(itemQuery, data);
      return message.reply({ embeds: [embed] });
    } catch (err) {
      console.error('!vend command error:', err);
      return message.reply('❌ Vending verileri aranırken bir hata oluştu.');
    }
  }

  // 3. GROQ AI CHAT LOGIC (When mentioned)
  if (message.mentions.has(client.user)) {
    try {
      const prompt = message.content.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
      
      if (!prompt) {
        return message.reply('Nasıl yardımcı olabilirim?');
      }

      await message.channel.sendTyping();

      const replyText = await askGroqAI(prompt);
      
      if (replyText.length > 2000) {
        await message.reply(replyText.substring(0, 1995) + '...');
      } else {
        await message.reply(replyText);
      }
    } catch (err) {
      console.error('Groq AI Error:', err);
      message.reply('İsteğiniz işlenirken bir hata oluştu.');
    }
  }
});

if (BOT_TOKEN) {
  client.login(BOT_TOKEN);
} else {
  console.log('DISCORD_TOKEN is missing. Bot will not login until DISCORD_TOKEN is set.');
}
