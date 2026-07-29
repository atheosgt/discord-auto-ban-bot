const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');

// --- RENDER 7/24 UYUMAMA SİSTEMİ (Express Web Sunucusu) ---
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Bot 7/24 aktif tutuluyor!');
});

app.listen(port, () => {
  console.log(`Web sunucusu ${port} portunda çalışıyor.`);
});

// --- DISCORD BOT KODLARI ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// Hedef Kanal ID'si ve Bot Tokeni (Render'dan çekilecek)
const TARGET_CHANNEL_ID = process.env.TARGET_CHANNEL_ID;
const BOT_TOKEN = process.env.DISCORD_TOKEN;

client.on('ready', () => {
  console.log(`Bot giriş yaptı: ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  // Bot mesajlarını ve hedef kanal dışındaki mesajları yoksay
  if (message.author.bot || message.channel.id !== TARGET_CHANNEL_ID) return;

  try {
    // Mesajı atan kullanıcıyı banla
    await message.guild.members.ban(message.author.id, { 
      reason: 'Tuzak kanala mesaj gönderildi.' 
    });
    
    // Attığı mesajı sil
    if (message.deletable) {
      await message.delete();
    }
    
    console.log(`${message.author.tag} tuzak kanala yazdığı için banlandı!`);
  } catch (err) {
    console.error('Ban hatası (Yetki eksik olabilir):', err);
  }
});

client.login(BOT_TOKEN);