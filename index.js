const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');

// --- KEEP-ALIVE SERVER FOR RENDER ---
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Bot & AI System is active 24/7!');
});

app.listen(port, () => {
  console.log(`Web server running on port ${port}`);
});

// --- GOOGLE GEMINI AI SETUP ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// --- DISCORD BOT SETUP ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

const TARGET_CHANNEL_ID = process.env.TARGET_CHANNEL_ID;
const BOT_TOKEN = process.env.DISCORD_TOKEN;

// Role IDs to assign with /give command
const ROLE_ID_1 = '1527450826698920026';
const ROLE_ID_2 = '1527450854209224835';

// Build the /give slash command
const commands = [
  new SlashCommandBuilder()
    .setName('give')
    .setDescription('Assign two specific roles to a user')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption(option => 
      option.setName('target')
        .setDescription('The user to receive the roles')
        .setRequired(true)
    )
];

// Register slash commands upon bot readiness
client.on('clientReady', async () => {
  console.log(`Logged in as ${client.user.tag}`);

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

// --- SLASH COMMAND INTERACTION HANDLER ---
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

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
});

// --- MESSAGE HANDLER (TRAP & AI) ---
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // 1. TRAP CHANNEL LOGIC
  if (message.channel.id === TARGET_CHANNEL_ID) {
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

  // 2. AI CHAT LOGIC (When mentioned)
  if (message.mentions.has(client.user)) {
    try {
      const prompt = message.content.replace(`<@${client.user.id}>`, '').trim();
      
      if (!prompt) {
        return message.reply('How can I help you?');
      }

      await message.channel.sendTyping();

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const replyText = response.text() || 'I could not generate a response.';
      
      if (replyText.length > 2000) {
        await message.reply(replyText.substring(0, 1995) + '...');
      } else {
        await message.reply(replyText);
      }
    } catch (err) {
      console.error('AI Error:', err);
      message.reply('An error occurred while processing your request.');
    }
  }
});

client.login(BOT_TOKEN);
