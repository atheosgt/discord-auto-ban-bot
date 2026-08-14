const { 
  Client, 
  GatewayIntentBits, 
  REST, 
  Routes, 
  SlashCommandBuilder, 
  PermissionFlagsBits, 
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActivityType,
  ComponentType
} = require('discord.js');
const express = require('express');

// --- OPTIONAL VOICE SUPPORT ---
let joinVoiceChannel = null;
try {
  const voice = require('@discordjs/voice');
  joinVoiceChannel = voice.joinVoiceChannel;
} catch (e) {
  // Voice package not available
}

// --- KEEP-ALIVE SERVER FOR RENDER / HOSTING ---
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Nebula Discord Bot & Proxy Sync System is active 24/7!');
});

app.listen(port, () => {
  console.log(`[Web Server] Running on port ${port}`);
});

// --- CONFIGURATION ---
const TARGET_CHANNEL_ID = process.env.TARGET_CHANNEL_ID;
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID || process.env.VOICE_CHANNEL;
const VENDFIND_CHANNEL_ID = process.env.VENDFIND_CHANNEL_ID || '1532358051342848183';
const BOT_TOKEN = process.env.DISCORD_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const NEBULA_SERVER_URL = (process.env.NEBULA_SERVER_URL || 'http://212.180.120.172:3000').replace(/\/$/, '');
const NEBULA_OWNER_PASSWORD = process.env.NEBULA_OWNER_PASSWORD || 'nebula_owner_sec';

// Role IDs
const ROLE_ID_1 = '1527450826698920026'; // Required role for /key and assigned by /give
const ROLE_ID_2 = '1527450854209224835';

// --- PRICE & EMOJI FORMATTER ---
function formatNebulaPrice(priceInput) {
  if (priceInput === undefined || priceInput === null) return 'N/A';
  
  if (typeof priceInput === 'number') {
    if (priceInput === 1 || priceInput === -1) return '1 :nebulawl:';
    if (priceInput > 1) return `${priceInput} :nebulawl:`;
    if (priceInput < -1) return `${-priceInput}/1 :nebulawl:`;
    return 'Not Set';
  }

  // String replacement (replace WL / WLs / wls with :nebulawl:)
  return String(priceInput)
    .replace(/\bWLs\b/gi, ':nebulawl:')
    .replace(/\bWL\b/gi, ':nebulawl:')
    .trim();
}

// --- GROQ AI CHAT HELPER ---
async function askGroqAI(prompt) {
  if (!GROQ_API_KEY) {
    return 'AI API Key is not configured. Please set the GROQ_API_KEY environment variable.';
  }

  const modelsToTry = [
    GROQ_MODEL,
    'llama-3.3-70b-versatile',
    'llama-3.1-70b-versatile',
    'llama-3.1-8b-instant',
    'mixtral-8x7b-32768'
  ];

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
              content: 'You are a helpful, friendly, and knowledgeable Discord assistant.'
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
        console.warn(`[Groq AI] Model ${model} returned error:`, errText);
      }
    } catch (e) {
      console.warn(`[Groq AI] Request failed for ${model}:`, e.message);
    }
  }

  return 'Sorry, the AI service is currently unavailable. Please try again later.';
}

// --- NEBULA STATS & VEND DATA FETCHER ---
let cachedTotalVends = 0;
let cachedTotalWorlds = 0;

/**
 * Fetches total tracked vending machines count from Nebula server
 */
async function fetchTotalVendingMachines() {
  // 1. Try /api/stats
  try {
    const res = await fetch(`${NEBULA_SERVER_URL}/api/stats`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000)
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.stats && data.stats.totalVends !== undefined) {
        const tv = Number(data.stats.totalVends) || 0;
        const tw = Number(data.stats.totalWorlds) || 0;
        if (tv > 0) {
          cachedTotalVends = tv;
          cachedTotalWorlds = tw;
        }
        return { totalVends: cachedTotalVends, totalWorlds: cachedTotalWorlds };
      }
    }
  } catch (e) {}

  // 2. Fallback: calculate from /vend_data_secret
  try {
    const res = await fetch(`${NEBULA_SERVER_URL}/vend_data_secret`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000)
    });

    if (res.ok) {
      const vendDb = await res.json();
      let totalVends = 0;
      const totalWorlds = Object.keys(vendDb).length;
      for (const w in vendDb) {
        if (vendDb[w] && Array.isArray(vendDb[w].items)) {
          totalVends += vendDb[w].items.length;
        }
      }
      if (totalVends > 0) {
        cachedTotalVends = totalVends;
        cachedTotalWorlds = totalWorlds;
      }
      return { totalVends: cachedTotalVends, totalWorlds: cachedTotalWorlds };
    }
  } catch (e) {}

  return { totalVends: cachedTotalVends, totalWorlds: cachedTotalWorlds };
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
      signal: AbortSignal.timeout(6000)
    });

    if (!res.ok) {
      const postRes = await fetch(`${NEBULA_SERVER_URL}/api/vends/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(6000)
      });
      if (postRes.ok) return await postRes.json();
      return { success: false, message: `Server error: HTTP ${res.status}` };
    }

    return await res.json();
  } catch (err) {
    console.error('[Vend Search Error]:', err.message);
    return { success: false, message: `Could not connect to Nebula Server: ${err.message}` };
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
      return await res.json();
    }
  } catch (e) {
    // Fallback to legacy endpoints below
  }

  // 2. Fallback: check key, unbind existing username if needed, then bind
  try {
    const keysRes = await fetch(`${NEBULA_SERVER_URL}/key_data_secret`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000)
    });

    if (keysRes.ok) {
      const allKeys = await keysRes.json();
      if (!allKeys || !allKeys[cleanKey]) {
        return { success: false, message: 'This license key does not exist in the database!' };
      }

      for (const k in allKeys) {
        if (k !== cleanKey && allKeys[k].username && allKeys[k].username.toLowerCase() === cleanUser.toLowerCase()) {
          return { success: false, message: 'This username is already linked to another license key!' };
        }
      }
    }

    // Unbind existing user
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
      return await bindRes.json();
    }

    return { success: false, message: 'Failed to update username for this license key.' };
  } catch (err) {
    console.error('[Key Update Error]:', err.message);
    return { success: false, message: `Server connection error: ${err.message}` };
  }
}

// --- VEND SEARCH PAGINATED EMBED CREATOR ---
const ITEMS_PER_PAGE = 5;

function createVendPageEmbed(query, data, page = 0) {
  if (!data || !data.success || !data.results || data.results.length === 0) {
    return new EmbedBuilder()
      .setColor(0xE74C3C)
      .setTitle(`🏪 Nebula Vend Search: "${query}"`)
      .setDescription('❌ No vending machines found selling this item.')
      .setFooter({ text: 'Nebula Proxy Vend System' })
      .setTimestamp();
  }

  const results = data.results;
  const count = data.count || results.length;
  const avgPriceFormatted = formatNebulaPrice(data.avg_price_str || 'N/A');
  const totalPages = Math.ceil(results.length / ITEMS_PER_PAGE) || 1;
  const currentPage = Math.max(0, Math.min(page, totalPages - 1));

  const startIndex = currentPage * ITEMS_PER_PAGE;
  const pageItems = results.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`🏪 Nebula Vend Search Results`)
    .setDescription(`🔎 **Item Query:** \`${query}\`\n📊 **Average Price:** ${avgPriceFormatted}\n📦 **Total Machines Found:** \`${count}\`\n───────────────────────────`)
    .setFooter({ text: `Page ${currentPage + 1} of ${totalPages} • Nebula Vend Explorer` })
    .setTimestamp();

  pageItems.forEach((item, idx) => {
    const globalIdx = startIndex + idx + 1;
    const priceStr = formatNebulaPrice(item.price_str || item.price);
    const pos = (item.x !== undefined && item.y !== undefined) ? `(X: ${item.x}, Y: ${item.y})` : '';
    const timeAgo = item.time_ago ? `• 🕒 ${item.time_ago}` : '';

    embed.addFields({
      name: `${globalIdx}. 🌍 World: **${item.world}**`,
      value: `📦 **Item:** ${item.item_name || query}\n💰 **Price:** **${priceStr}** ${pos} ${timeAgo}`,
      inline: false
    });
  });

  return embed;
}

function createVendPaginationRow(currentPage, totalPages, customIdPrefix) {
  const prevBtn = new ButtonBuilder()
    .setCustomId(`${customIdPrefix}_prev`)
    .setLabel('◀ Previous')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(currentPage <= 0);

  const pageIndicator = new ButtonBuilder()
    .setCustomId(`${customIdPrefix}_page`)
    .setLabel(`${currentPage + 1} / ${totalPages}`)
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(true);

  const nextBtn = new ButtonBuilder()
    .setCustomId(`${customIdPrefix}_next`)
    .setLabel('Next ▶')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(currentPage >= totalPages - 1);

  return new ActionRowBuilder().addComponents(prevBtn, pageIndicator, nextBtn);
}

// --- DISCORD CLIENT SETUP ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates
  ],
  presence: {
    status: 'online',
    activities: [
      {
        name: '📦 Scanning Vending Machines | Nebula',
        type: ActivityType.Watching
      }
    ]
  }
});

// Slash commands definition (Full English)
const commands = [
  new SlashCommandBuilder()
    .setName('give')
    .setDescription('Assign specialized roles to a specific user')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption(option => 
      option.setName('target')
        .setDescription('The user to receive the roles')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('key')
    .setDescription('Bind or change the Growtopia/Nebula username linked to your license key')
    .addStringOption(option =>
      option.setName('key')
        .setDescription('Your original Nebula License Key (e.g., Nebula-XXXXX or TEST_KEY)')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('username')
        .setDescription('Your desired Growtopia/Nebula username to bind')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('vend')
    .setDescription('Search Growtopia items and prices across all vending machines')
    .addStringOption(option =>
      option.setName('item')
        .setDescription('Item name or ID to search for (e.g., magplant, dirt, 242)')
        .setRequired(true)
    )
];

// --- VOICE AUTO-JOIN HELPER ---
async function joinTargetVoiceChannel() {
  if (!VOICE_CHANNEL_ID) return;

  try {
    const channel = await client.channels.fetch(VOICE_CHANNEL_ID);
    if (!channel || !channel.isVoiceBased()) {
      console.warn(`[Voice] Channel ID ${VOICE_CHANNEL_ID} is not a valid voice channel.`);
      return;
    }

    if (joinVoiceChannel) {
      joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
        selfDeaf: true,
        selfMute: true
      });
      console.log(`[Voice] Successfully joined voice channel: #${channel.name}`);
    } else {
      console.log('[Voice] @discordjs/voice is not available.');
    }
  } catch (err) {
    console.error('[Voice Error] Failed to join voice channel:', err.message);
  }
}

// --- PERSISTENT ACTIVITY UPDATER ---
async function updateProxyStatsAndPresence() {
  if (!client.user) return;

  try {
    const { totalVends } = await fetchTotalVendingMachines();
    const countToDisplay = (totalVends > 0) ? totalVends : (cachedTotalVends > 0 ? cachedTotalVends : 0);

    const activityText = countToDisplay > 0 
      ? `📦 ${countToDisplay.toLocaleString()} Vending Machines | Nebula` 
      : '📦 Scanning Vending Machines | Nebula';

    client.user.setPresence({
      status: 'online',
      activities: [
        {
          name: activityText,
          type: ActivityType.Watching
        }
      ]
    });

    console.log(`[Activity Updated] "${activityText}"`);
  } catch (err) {
    console.error('[Activity Update Error]:', err.message);
  }
}

// Register slash commands upon bot readiness
client.on('clientReady', async () => {
  console.log(`[Bot Ready] Logged in as ${client.user.tag}`);

  // 1. Join voice channel if configured
  await joinTargetVoiceChannel();

  // 2. Fetch and set presence immediately, then update every 10 seconds
  await updateProxyStatsAndPresence();
  setInterval(updateProxyStatsAndPresence, 10000);

  // 3. Register Slash Commands
  if (!BOT_TOKEN) {
    console.warn('WARNING: DISCORD_TOKEN is missing in environment variables.');
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

client.on('shardResume', () => {
  updateProxyStatsAndPresence();
});

// --- SLASH COMMAND INTERACTION HANDLER ---
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // 1. /give COMMAND
  if (interaction.commandName === 'give') {
    const targetMember = interaction.options.getMember('target');

    if (!targetMember) {
      return interaction.reply({ content: 'User could not be found in this server.', flags: 64 });
    }

    try {
      await targetMember.roles.add([ROLE_ID_1, ROLE_ID_2]);
      await interaction.reply({ 
        content: `Successfully granted both roles to ${targetMember.user.tag}!` 
      });
    } catch (err) {
      console.error('Failed to assign roles:', err);
      await interaction.reply({ 
        content: 'Failed to assign roles. Please check my permissions and role hierarchy.', 
        flags: 64 
      });
    }
  }

  // 2. /key COMMAND (Key & Username Bind/Change with Role Restriction)
  if (interaction.commandName === 'key') {
    // Check if the user has the required role (ROLE_ID_1: 1527450826698920026)
    const member = interaction.member;
    const hasRequiredRole = member && (
      (member.roles?.cache && member.roles.cache.has(ROLE_ID_1)) ||
      (Array.isArray(member.roles) && member.roles.includes(ROLE_ID_1))
    );

    if (!hasRequiredRole) {
      return interaction.reply({
        content: `❌ **Access Denied:** You must have the <@&${ROLE_ID_1}> role to use the \`/key\` command.`,
        flags: 64
      });
    }

    // Ephemeral reply so license keys are never leaked to the channel
    await interaction.deferReply({ flags: 64 });

    const key = interaction.options.getString('key').trim();
    const username = interaction.options.getString('username').trim();

    if (username.length < 3 || username.length > 24) {
      return interaction.editReply({ 
        content: '❌ **Error:** Username must be between 3 and 24 characters long.' 
      });
    }

    const res = await updateNebulaKey(key, username);

    if (res && res.success) {
      const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('✅ Nebula License Key Updated')
        .setDescription('Your license key has been successfully bound to your new username!')
        .addFields(
          { name: '🔑 License Key', value: `\`||${key}||\``, inline: true },
          { name: '👤 Bound Username', value: `\`${username}\``, inline: true }
        )
        .setFooter({ text: 'Nebula Proxy Licensing System' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } else {
      const errMsg = res?.message || 'Failed to update license key.';
      const embed = new EmbedBuilder()
        .setColor(0xE74C3C)
        .setTitle('❌ Action Failed')
        .setDescription(`**Error:** ${errMsg}`)
        .setFooter({ text: 'Nebula Proxy Licensing System' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    }
  }

  // 3. /vend COMMAND (Paginated Vend Search with Channel Restriction)
  if (interaction.commandName === 'vend') {
    // Channel Restriction: Only allow in VENDFIND_CHANNEL_ID (1532358051342848183)
    if (VENDFIND_CHANNEL_ID && interaction.channelId !== VENDFIND_CHANNEL_ID) {
      return interaction.reply({
        content: `❌ **Wrong Channel:** This command can only be used in <#${VENDFIND_CHANNEL_ID}>!`,
        flags: 64
      });
    }

    await interaction.deferReply();
    const itemQuery = interaction.options.getString('item').trim();

    const data = await searchNebulaVends(itemQuery);
    let currentPage = 0;
    const totalResults = data?.results?.length || 0;
    const totalPages = Math.ceil(totalResults / ITEMS_PER_PAGE) || 1;

    const embed = createVendPageEmbed(itemQuery, data, currentPage);
    const customIdPrefix = `vend_slash_${interaction.id}`;

    let replyMessage;
    if (totalPages > 1) {
      const row = createVendPaginationRow(currentPage, totalPages, customIdPrefix);
      replyMessage = await interaction.editReply({ embeds: [embed], components: [row] });

      const collector = replyMessage.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 300000 // 5 minutes
      });

      collector.on('collect', async (i) => {
        if (i.user.id !== interaction.user.id) {
          return i.reply({ content: 'Only the command author can browse pages.', flags: 64 });
        }

        if (i.customId === `${customIdPrefix}_prev`) {
          currentPage = Math.max(0, currentPage - 1);
        } else if (i.customId === `${customIdPrefix}_next`) {
          currentPage = Math.min(totalPages - 1, currentPage + 1);
        }

        const newEmbed = createVendPageEmbed(itemQuery, data, currentPage);
        const newRow = createVendPaginationRow(currentPage, totalPages, customIdPrefix);
        await i.update({ embeds: [newEmbed], components: [newRow] });
      });

      collector.on('end', async () => {
        try {
          await interaction.editReply({ components: [] });
        } catch (e) {}
      });
    } else {
      await interaction.editReply({ embeds: [embed] });
    }
  }
});

// --- MESSAGE HANDLER (!vend, TRAP & AI) ---
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // 1. TRAP CHANNEL LOGIC
  if (TARGET_CHANNEL_ID && message.channel.id === TARGET_CHANNEL_ID) {
    try {
      await message.guild.members.ban(message.author.id, { 
        reason: 'Triggered the honeypot trap channel.' 
      });
      if (message.deletable) await message.delete();
      console.log(`[Trap] Banned ${message.author.tag} in honeypot channel.`);
    } catch (err) {
      console.error('[Trap Error]:', err);
    }
    return;
  }

  const content = message.content.trim();

  // 2. !vend <item_name> COMMAND (Channel Restricted & Paginated)
  if (content.toLowerCase().startsWith('!vend')) {
    // Channel Restriction: Only allow in VENDFIND_CHANNEL_ID (1532358051342848183)
    if (VENDFIND_CHANNEL_ID && message.channel.id !== VENDFIND_CHANNEL_ID) {
      return message.reply(`❌ **Wrong Channel:** This command can only be used in <#${VENDFIND_CHANNEL_ID}>!`);
    }

    const itemQuery = content.slice(5).trim();

    if (!itemQuery) {
      return message.reply('ℹ️ **Usage:** `!vend <item_name or ID>`\n*Example:* `!vend magplant` or `!vend dirt`');
    }

    try {
      await message.channel.sendTyping();
      const data = await searchNebulaVends(itemQuery);
      let currentPage = 0;
      const totalResults = data?.results?.length || 0;
      const totalPages = Math.ceil(totalResults / ITEMS_PER_PAGE) || 1;

      const embed = createVendPageEmbed(itemQuery, data, currentPage);
      const customIdPrefix = `vend_msg_${message.id}`;

      if (totalPages > 1) {
        const row = createVendPaginationRow(currentPage, totalPages, customIdPrefix);
        const sentMessage = await message.reply({ embeds: [embed], components: [row] });

        const collector = sentMessage.createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: 300000 // 5 minutes
        });

        collector.on('collect', async (i) => {
          if (i.user.id !== message.author.id) {
            return i.reply({ content: 'Only the command author can browse pages.', flags: 64 });
          }

          if (i.customId === `${customIdPrefix}_prev`) {
            currentPage = Math.max(0, currentPage - 1);
          } else if (i.customId === `${customIdPrefix}_next`) {
            currentPage = Math.min(totalPages - 1, currentPage + 1);
          }

          const newEmbed = createVendPageEmbed(itemQuery, data, currentPage);
          const newRow = createVendPaginationRow(currentPage, totalPages, customIdPrefix);
          await i.update({ embeds: [newEmbed], components: [newRow] });
        });

        collector.on('end', async () => {
          try {
            await sentMessage.edit({ components: [] });
          } catch (e) {}
        });
      } else {
        return message.reply({ embeds: [embed] });
      }
    } catch (err) {
      console.error('[!vend Error]:', err);
      return message.reply('❌ An error occurred while searching for vending machines.');
    }
  }

  // 3. GROQ AI CHAT LOGIC (When mentioned)
  if (message.mentions.has(client.user)) {
    try {
      const prompt = message.content.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
      
      if (!prompt) {
        return message.reply('Hello! How can I assist you today?');
      }

      await message.channel.sendTyping();

      const replyText = await askGroqAI(prompt);
      
      if (replyText.length > 2000) {
        await message.reply(replyText.substring(0, 1995) + '...');
      } else {
        await message.reply(replyText);
      }
    } catch (err) {
      console.error('[AI Chat Error]:', err);
      message.reply('An error occurred while processing your request.');
    }
  }
});

if (BOT_TOKEN) {
  client.login(BOT_TOKEN);
} else {
  console.log('[Warning] DISCORD_TOKEN is missing. Bot will not login until DISCORD_TOKEN is set.');
}
