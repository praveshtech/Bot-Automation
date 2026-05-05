require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const { Client, GatewayIntentBits, ChannelType, PermissionsBitField } = require('discord.js');

// --- 1. FIREBASE SETUP ---
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// --- 2. EXPRESS SERVER (Render ke liye zaroori) ---
const app = express();
app.use(cors());
app.use(express.json());
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => res.send('Bot Automation is Live!'));

app.listen(PORT, () => {
    console.log(`🌐 Web Server running on port ${PORT}`);
});

// --- 3. DISCORD BOT SETUP ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

// Anti-Crash System
process.on('unhandledRejection', error => console.error('❌ Error:', error));

client.once('ready', () => {
    console.log(`✅ BOT ONLINE: Logged in as ${client.user.tag}`);
});

// --- 4. TICKET SYSTEM (NO BUTTONS) ---
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Command: !ticket (Naya ticket banana)
    if (message.content === '!ticket') {
        try {
            const ticketChannel = await message.guild.channels.create({
                name: `ticket-${message.author.username}`,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: message.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }, // Sabse chupana
                    { id: message.author.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }, // User ko dikhana
                    { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] } // Bot ko dikhana
                ],
            });

            await message.reply(`✅ Aapka ticket yahan ban gaya hai: <#${ticketChannel.id}>`);
            await ticketChannel.send(`<@${message.author.id}> Apni problem yahan bataiye. \n*(Ticket band karne ke liye chat mein **!close** likhein)*`);
        } catch (err) {
            console.error(err);
            message.reply("❌ Error! Bot ko server settings mein 'Administrator' permission dein.");
        }
    }

    // Command: !close (Ticket delete karna)
    if (message.content === '!close' && message.channel.name.startsWith('ticket-')) {
        message.channel.send('Ticket 3 second mein close ho jayega...');
        setTimeout(() => { message.channel.delete().catch(console.error); }, 3000);
    }
});

// Bot Login
client.login(process.env.DISCORD_TOKEN).catch(console.error);