const { Client, GatewayIntentBits } = require('discord.js');
const Groq = require('groq-sdk');
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

// --- GROQ AI SETUP ---
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

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

// Specific Role ID required to use !give command
const ALLOWED_ROLE_ID = '1527451436357648414';

// Role IDs to assign with !give command
const ROLE_ID_1 = '1527450826698920026';
const ROLE_ID_2 = '1527450854209224835';

client.on('clientReady', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// --- MESSAGE HANDLER (TRAP, AI & !give COMMAND) ---
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

  // 2. !give COMMAND LOGIC
  if (message.content.startsWith('!give')) {
    // Check if the user executing the command has the specific allowed role
    if (!message.member.roles.cache.has(ALLOWED_ROLE_ID)) {
      return message.reply('You do not have the required role to use this command.');
    }

    const targetMember = message.mentions.members.first();

    if (!targetMember) {
      return message.reply('Please mention a valid user. Example: `!give @User`');
    }

    try {
      await targetMember.roles.add([ROLE_ID_1, ROLE_ID_2]);
      await message.reply(`Successfully granted both roles to ${targetMember.user.tag}!`);
    } catch (err) {
      console.error('Failed to assign roles:', err);
      await message.reply('Failed to assign roles. Please check my permissions and role hierarchy.');
    }
    return;
  }

  // 3. AI CHAT LOGIC (GROQ - When mentioned)
  if (message.mentions.has(client.user)) {
    try {
      const prompt = message.content.replace(`<@${client.user.id}>`, '').trim();
      
      if (!prompt) {
        return message.reply('How can I help you?');
      }

      await message.channel.sendTyping();

      const chatCompletion = await groq.chat.completions.create({
        messages: [
          { role: 'system', content: 'You are a helpful Discord assistant.' },
          { role: 'user', content: prompt }
        ],
        model: 'llama-3.3-70b-versatile',
      });

      const replyText = chatCompletion.choices[0]?.message?.content || 'I could not generate a response.';
      
      if (replyText.length > 2000) {
        await message.reply(replyText.substring(0, 1995) + '...');
      } else {
        await message.reply(replyText);
      }
    } catch (err) {
      console.error('Groq AI Error:', err);
      message.reply('An error occurred while processing your request.');
    }
  }
});

client.login(BOT_TOKEN);
