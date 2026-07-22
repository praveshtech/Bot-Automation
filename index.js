require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const axios = require('axios');
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionsBitField, ChannelType, AttachmentBuilder } = require('discord.js');
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');
const excelJS = require('exceljs'); 
const faqData = require('./faqs.json');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const discordTranscripts = require('discord-html-transcripts');

// ==========================================
// 1. FIREBASE SETUP
// ==========================================
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: "professor-discord-556ae.firebasestorage.app"
});
const db = admin.firestore(); 
const bucket = admin.storage().bucket(); 
let globalLastUpdate = Date.now();

async function uploadImageToFirebase(imageUrl, userId, type) {
    try {
        const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'utf-8');
        const fileName = `kyc_documents/${userId}_${type}_${Date.now()}.png`;
        const file = bucket.file(fileName);
        await file.save(buffer, { contentType: 'image/png' });
        const [url] = await file.getSignedUrl({ action: 'read', expires: '01-01-2100' });
        return url;
    } catch (error) {
        console.error(`Error uploading ${type} for ${userId}:`, error);
        return null;
    }
}

// ==========================================
// 2. DISCORD BOT INIT
// ==========================================
const client = new Client({ intents: [ GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildPresences ] });
const userSelections = new Map();

client.once('ready', async () => {
    console.log(`✅ BOT ONLINE: Logged in as ${client.user.tag}`);
    console.log(`🔥 FIREBASE: Connected Successfully`);
    
    // 🔥 SLASH COMMANDS REGISTRATION
    try {
        await client.application.commands.set([
            { name: 'complete', description: 'Shift ticket to completed category for night settlement' },
            { name: 'match', description: 'Match this ticket with another (Escrow)', options: [{ name: 'target', type: 3, description: 'Type category name (e.g., MATCH 01). Leave empty to create new.', required: false }] },
            { name: 'unmatch', description: 'Unmatch this ticket and return to original category' }
        ]);
        console.log(`✅ Slash Commands Registered Successfully!`);
    } catch (err) { console.error("Slash Command Registration Error:", err); }

    // Existing Leaderboard Interval
    setInterval(() => {
        client.guilds.cache.forEach(guild => { 
            updateWeeklyLeaderboard(guild); 
            updateHeistLeaderboard(guild); 
        });
    }, 60 * 60 * 1000);

    // Inactive KYC/UPI Ticket Auto-Delete System
    setInterval(() => {
        const TWELVE_HOURS = 12 * 60 * 60 * 1000;
        const now = Date.now();

        client.guilds.cache.forEach(async guild => {
            const kycChannels = guild.channels.cache.filter(c => 
                (c.name.startsWith('kyc-') && c.name !== 'kyc-requests') || c.name.startsWith('upi-')
            );

            for (const [id, channel] of kycChannels) {
                try {
                    const messages = await channel.messages.fetch({ limit: 1 });
                    const lastMessage = messages.first();
                    const lastActivityTime = lastMessage ? lastMessage.createdTimestamp : channel.createdTimestamp;

                    if (now - lastActivityTime > TWELVE_HOURS) {
                        console.log(`🗑️ Auto-Deleting inactive KYC channel: ${channel.name}`);
                        await channel.delete('Inactive for 12 hours');
                    }
                } catch (err) { console.error(`Error checking/deleting channel ${channel.name}:`, err); }
            }
        });
    }, 60 * 60 * 1000); 
});

// ==========================================
// 🛠️ DISCORD MESSAGE COMMANDS (TEXT)
// ==========================================
let p2pMessageCount = 0;

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (message.channel.name === '💬・p2p-chat' || message.channel.name.includes('p2p-chat')) {
        p2pMessageCount++; 
        if (p2pMessageCount >= 10) {
            p2pMessageCount = 0; 
            const scamAlertEmbed = new EmbedBuilder()
                .setColor('#e74c3c') 
                .setTitle('🚨 SCAM ALERT | NO DM DEALS')
                .setDescription('**Scammers are using fake Admin names (like Berlin) in DMs.**\n\n⚠️ **Admins will NEVER DM you first.**\n⚠️ **If anyone DMs you for a trade, THEY ARE A SCAMMER.**\n⚠️ **All real trades ONLY happen in Ticket Rooms.**\n\n> *Block unsolicited DMs immediately. Stay safe!*')
                .setFooter({ text: 'Professor Network Security', iconURL: client.user.displayAvatarURL() });

            await message.channel.send({ embeds: [scamAlertEmbed] });
        }
    }

    const command = message.content.trim().toLowerCase();

    if (faqData[command]) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator) && !message.member.roles.cache.some(role => role.name === 'Palermo')) return;
        const faqEmbed = new EmbedBuilder().setColor(faqData[command].color).setTitle(faqData[command].title).setDescription(faqData[command].desc).setFooter({ text: 'Professor Network Support', iconURL: client.user.displayAvatarURL() });

        if (message.reference) {
            try {
                const repliedMsg = await message.channel.messages.fetch(message.reference.messageId);
                await repliedMsg.reply({ content: `Hey ${repliedMsg.author.toString()}, here is the information you requested:`, embeds: [faqEmbed] });
                await message.delete().catch(()=>{}); 
            } catch (e) { await message.channel.send({ embeds: [faqEmbed] }); }
        } else {
            await message.channel.send({ embeds: [faqEmbed] });
            await message.delete().catch(()=>{});
        }
        return; 
    }

    if (message.channel.id === '1495117550709903591') {
        try {
            const feedRole = message.guild.roles.cache.find(r => r.name === 'transaction done');
            if (feedRole && message.member.roles.cache.has(feedRole.id)) {
                await message.react('⭐');
                await message.react('✅');
            }
        } catch (error) {}
    }

    // ADMIN COMMAND: .fb (WITH TRANSCRIPT SAVING)
    if (command === '.fb') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator) && !message.member.roles.cache.some(role => role.name === 'Palermo')) return;
        try {
            const ticketDoc = await db.collection('p2p_tickets').doc(message.channel.id).get();
            if (!ticketDoc.exists) return message.reply({ content: "❌ You can only use `.fb` inside a valid P2P ticket channel.", ephemeral: true });
            
            const ticketData = ticketDoc.data();
            const userId = ticketData.discordUserId;
            const targetMember = await message.guild.members.fetch(userId).catch(() => null);
            
            // ==========================================
            // 📜 1. TRANSCRIPT GENERATION SYSTEM (SMART HTML)
            // ==========================================
            const loadingMsg = await message.channel.send("⏳ *Generating secure chat transcript...*");
            
            try {
                // 1. Chat ke saare messages fetch karna
                const fetchedMessages = await message.channel.messages.fetch({ limit: 100 });
                
                // 2. 🔥 SMART FILTER: Un messages ko ignore karna jisme Buttons/Dropdowns (components) hain, kyu ki wahi package ko crash karwa rahe the.
                const safeMessages = fetchedMessages.filter(m => m.components.length === 0);

                // 3. Wapas HTML package ka use karna aur safe messages bhejna
                const attachment = await discordTranscripts.generateFromMessages(safeMessages, message.channel, {
                    returnType: 'attachment',
                    filename: `transcript-${ticketData.username || 'user'}-${message.channel.name}.html`,
                    saveImages: true, // 🔥 Ab images HTML ke andar hi save hongi!
                    poweredBy: true
                });

                // History channel dhoondhna ya naya banana
                let historyChannel = message.guild.channels.cache.find(c => c.name === 'transaction-history');
                if (!historyChannel) {
                    historyChannel = await message.guild.channels.create({
                        name: 'transaction-history',
                        type: ChannelType.GuildText,
                        permissionOverwrites: [
                            { id: message.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                            { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                        ]
                    });
                    const palermoRole = message.guild.roles.cache.find(r => r.name === 'Palermo');
                    if (palermoRole) await historyChannel.permissionOverwrites.edit(palermoRole.id, { ViewChannel: true });
                }

                // History channel mein Embed aur transcript file bhejna
                const histEmbed = new EmbedBuilder()
                    .setColor('#3498db')
                    .setTitle(`📜 Chat Transcript: ${message.channel.name}`)
                    .addFields(
                        { name: 'User', value: `<@${userId}> (${ticketData.username || 'Unknown'})`, inline: true },
                        { name: 'Trade Details', value: `${ticketData.tradeType} - $${ticketData.amountUsd || 0}`, inline: true },
                        { name: 'Method', value: `${ticketData.networkOrMethod || 'Unknown'}`, inline: true }
                    )
                    .setTimestamp()
                    .setFooter({ text: 'Professor Network - Vault Records', iconURL: client.user.displayAvatarURL() });

                await historyChannel.send({ embeds: [histEmbed], files: [attachment] });
                await loadingMsg.delete().catch(()=>{});
            } catch (transcriptErr) {
                console.error("Transcript Error:", transcriptErr);
                await loadingMsg.delete().catch(()=>{});
                await message.channel.send("⚠️ *Warning: Transcript generation failed, but continuing with feedback process.*");
            }

            // ==========================================
            // ⭐ 2. ROLE ASSIGNMENT & FEEDBACK PROMPT
            // ==========================================
            if (targetMember) {
                let feedRole = message.guild.roles.cache.find(r => r.name === 'transaction done');
                if (!feedRole) { feedRole = await message.guild.roles.create({ name: 'transaction done', color: '#f1c40f', reason: 'Temporary role for leaving a transaction review' }); }
                await targetMember.roles.add(feedRole);

                const feedbackPromptEmbed = new EmbedBuilder().setColor('#f1c40f').setTitle('⭐ Rate Your Experience!').setDescription(`Hello <@${userId}>, your transaction has been successfully completed! 🏦\n\nYour trust means everything to us. Could you take a quick moment to share your experience with **Professor Network**? \n\nYour honest review helps our community grow and helps others trade safely. 🤝\n\n👉 **Drop your feedback here:** <#1495117550709903591>\n\nThank you for choosing us! ⚡`).setFooter({ text: 'Professor Network • Trust & Transparency', iconURL: client.user.displayAvatarURL() });

                await message.delete().catch(() => {});
                await message.channel.send({ content: `🔔 <@${userId}>`, embeds: [feedbackPromptEmbed] });
            }

            // ==========================================
            // 🗑️ 3. AUTO-DELETE BANK DETAILS LOG ON .fb
            // ==========================================
            try {
                const bankDetailsChannel = message.guild.channels.cache.find(c => c.name === '🏦・bank-details' || c.name.includes('bank-details'));
                if (bankDetailsChannel) {
                    const fetchedLogs = await bankDetailsChannel.messages.fetch({ limit: 100 });
                    const logToDelete = fetchedLogs.find(m => 
                        m.embeds.length > 0 && 
                        m.embeds[0].fields && 
                        m.embeds[0].fields.some(f => f.name === '🎫 Ticket' && f.value.includes(message.channel.id))
                    );
                    if (logToDelete) await logToDelete.delete();
                }
            } catch (err) { console.error("Bank detail log delete error:", err); }

            // ==========================================
            // 📂 4. SHIFT TICKET TO COMPLETED CATEGORY
            // ==========================================
            const targetCategoryName = ticketData.tradeType === 'Buy' ? '🟢 COMPLETED BUY' : '🔴 COMPLETED SELL';
            let targetCategory = message.guild.channels.cache.find(c => c.name === targetCategoryName && c.type === ChannelType.GuildCategory);
            
            if (!targetCategory) {
                targetCategory = await message.guild.channels.create({ name: targetCategoryName, type: ChannelType.GuildCategory });
            }
            
            // Parent change kar rahe hain ticket shift karne ke liye
            await message.channel.setParent(targetCategory.id, { lockPermissions: false });

            const completeEmbed = new EmbedBuilder()
                .setColor('#2ecc71')
                .setTitle('✅ Ticket Completed & Shifted')
                .setDescription(`Ticket moved to **${targetCategoryName}** and bank details cleared securely.`);
            
            const shiftMsg = await message.channel.send({ embeds: [completeEmbed] });
            setTimeout(() => shiftMsg.delete().catch(()=>{}), 5000);

        } catch (error) {
            console.error("Critical error in .fb command:", error);
            await message.channel.send("❌ Internal Server Error during the .fb process.");
        }
    }

    // ==========================================
    // 🧮 ADMIN COMMAND: .am (Payment Tracker)
    // ==========================================
    if (command.startsWith('.am')) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator) && !message.member.roles.cache.some(role => role.name === 'Palermo')) return;
        
        try {
            const ticketRef = db.collection('p2p_tickets').doc(message.channel.id);
            const ticketDoc = await ticketRef.get();
            
            if (!ticketDoc.exists) return message.reply({ content: "❌ Yeh command sirf valid P2P ticket channel mein chalega.", ephemeral: true });
            
            const ticketData = ticketDoc.data();
            
            // Total INR ya bacha hua INR database se nikal rahe hain
            let currentRemaining = ticketData.remainingInr !== undefined ? ticketData.remainingInr : ticketData.totalInr;
            
            if (currentRemaining === undefined || currentRemaining === null) {
                return message.channel.send("❌ Is ticket mein Total INR calculate nahi hua hai.");
            }

            // 🔍 FEATURE 1: Agar sirf ".am" likha hai, toh sirf balance show karega
            if (command === '.am') {
                const infoEmbed = new EmbedBuilder()
                    .setColor('#f1c40f') // Yellow color for info
                    .setTitle('🧮 Payment Tracker Info')
                    .setDescription(`Current payment status for **${ticketData.username || 'User'}**`)
                    .addFields(
                        { name: '🧾 Remaining Balance', value: `**₹${currentRemaining.toFixed(2)}**`, inline: false }
                    )
                    .setFooter({ text: 'Professor Network - Vault Analytics', iconURL: client.user.displayAvatarURL() });
                
                await message.delete().catch(() => {});
                return message.channel.send({ embeds: [infoEmbed] });
            }

            // 📉 FEATURE 2: Agar amount daala hai (jaise .am 3000), toh minus karega
            const amountMatch = message.content.match(/\.am\s*-?\s*(\d+(\.\d+)?)/i);
            if (!amountMatch) {
                return message.reply({ content: '❌ Galat format! Use karein: `.am` (check karne ke liye) ya `.am 3000` (minus karne ke liye)', ephemeral: true }).then(m => setTimeout(() => m.delete().catch(()=>{}), 5000));
            }
            
            const paidAmount = parseFloat(amountMatch[1]);
            let newRemaining = currentRemaining - paidAmount;
            if (newRemaining < 0) newRemaining = 0; // Minus mein na jaye
            
            // Database mein naya bacha hua balance save karein
            await ticketRef.update({ remainingInr: newRemaining });
            
            const amEmbed = new EmbedBuilder()
                .setColor('#3498db') // Blue color for calculation
                .setTitle('🧮 Partial Payment Tracker')
                .setDescription(`Payment calculation updated for **${ticketData.username || 'User'}**`)
                .addFields(
                    { name: '💰 Previous Balance', value: `₹${currentRemaining.toFixed(2)}`, inline: true },
                    { name: '➖ Amount Paid Now', value: `₹${paidAmount.toFixed(2)}`, inline: true },
                    { name: '🧾 Remaining Balance', value: `**₹${newRemaining.toFixed(2)}**`, inline: false }
                )
                .setFooter({ text: 'Professor Network - Vault Analytics', iconURL: client.user.displayAvatarURL() });
                
            await message.delete().catch(() => {}); // Admin ka text delete karega taaki chat clean rahe
            await message.channel.send({ embeds: [amEmbed] });
            
        } catch (err) {
            console.error("Error in .am command:", err);
            await message.channel.send("❌ Database update mein error aaya.");
        }
    }

    if (command === '!p2p') {
        if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply({ content: "❌ Action Denied.", ephemeral: true });
        try {
            const setupEmbed = new EmbedBuilder().setColor('#2b2d31').setTitle('🏦 Exchange Desk (P2P)').setDescription('Welcome to the Professor Network.\n\nClick the button below to start trading securely.').setFooter({ text: 'Automated by Professor Network' });
            const buttons = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('start_p2p_trade').setLabel('🚀 Start Trade').setStyle(ButtonStyle.Primary));
            await message.channel.send({ embeds: [setupEmbed], components: [buttons] });
            await message.delete().catch(() => {});
        } catch (err) {}
    }

    if (message.content === '!flash') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        await message.delete().catch(() => {});
        const setupEmbed = new EmbedBuilder().setTitle('⚡ Flash Deal Setup').setDescription('Click below to create deal. (Visible for 15 seconds only)').setColor('#2b2d31');
        const dealBtn = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('open_flash_modal').setLabel('Create Flash Deal').setStyle(ButtonStyle.Danger).setEmoji('⚡'));
        const setupMsg = await message.channel.send({ embeds: [setupEmbed], components: [dealBtn] });
        setTimeout(() => { setupMsg.delete().catch(() => {}); }, 15000);
    }

    if (command === '!poll') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator) && !message.member.roles.cache.some(role => role.name === 'Palermo')) return;
        await message.delete().catch(() => {});
        const setupEmbed = new EmbedBuilder().setTitle('📊 Server Poll Setup').setDescription('Click the button below to create a new community poll.').setColor('#3498db').setFooter({ text: 'Professor Network - Poll System' });
        const pollBtn = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('open_poll_modal').setLabel('Create Poll').setStyle(ButtonStyle.Primary).setEmoji('📊'));
        await message.channel.send({ embeds: [setupEmbed], components: [pollBtn] });
    }
     
    if (command === '!setupadvkyc') {
        if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        try {
            const advKycEmbed = new EmbedBuilder().setColor('#2ecc71').setTitle('🛡️ Advanced KYC (Vault Verified)').setDescription('> **Unlock $0 Fee Trades by verifying your identity.**\n\nClick the button below to open a private, secure verification room where you can upload your Aadhaar and PAN Card.\n\n`Your data is securely encrypted and reviewed strictly by Admins.`').setFooter({ text: 'Professor Network - Secure KYC Terminal', iconURL: client.user.displayAvatarURL() });
            const advKycBtn = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('start_advanced_kyc').setLabel('Start Advanced KYC').setStyle(ButtonStyle.Success).setEmoji('🛡️'));
            await message.channel.send({ embeds: [advKycEmbed], components: [advKycBtn] });
            await message.delete().catch(()=>{});
        } catch (err) {}
    }

    if (command === '!verify') {
        if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        try {
            const kycEmbed = new EmbedBuilder().setColor('#2b2d31').setTitle('📝 Basic Network Verification').setDescription('> **To join the community legally, submit your basic details here.**\n\n`Note: If You Want $0 Fee on P2P trades use P2P WITH KYC, a separate ID verification is required at the Exchange Desk.`').setFooter({ text: '🔒 Data is encrypted and stored securely.' });
            const kycButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('start_kyc_form').setLabel('Verify').setStyle(ButtonStyle.Primary).setEmoji('📝'));
            await message.channel.send({ embeds: [kycEmbed], components: [kycButton] });
            await message.delete().catch(()=>{});
        } catch (err) {}
    }

    if (command.startsWith('!grantupi')) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator) && !message.member.roles.cache.some(role => role.name === 'Palermo')) return;
        const targetUser = message.mentions.members.first();
        if (!targetUser) return message.reply({ content: '❌ Please mention a user. Example: `!grantupi @username`', ephemeral: true });

        try {
            let upiRole = message.guild.roles.cache.find(r => r.name === 'UPI Eligible');
            if (!upiRole) { upiRole = await message.guild.roles.create({ name: 'UPI Eligible', color: '#3498db', reason: 'Role for Exclusive UPI P2P Access' }); }
            await targetUser.roles.add(upiRole);
            const successEmbed = new EmbedBuilder().setColor('#2ecc71').setTitle('🎥 UPI Access Granted').setDescription(`Successfully granted **UPI KYC Access** to ${targetUser.toString()}.\nThey can now see the exclusive UPI channel.`);
            await message.reply({ embeds: [successEmbed] });
            await message.delete().catch(() => {}); 
        } catch (err) {}
    }

    if (command.startsWith('!revokeupi')) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator) && !message.member.roles.cache.some(role => role.name === 'Palermo')) return;
        const targetUser = message.mentions.members.first();
        if (!targetUser) return message.reply({ content: '❌ Please mention a user. Example: `!revokeupi @username`', ephemeral: true });

        try {
            const upiRole = message.guild.roles.cache.find(r => r.name === 'UPI Eligible');
            if (upiRole && targetUser.roles.cache.has(upiRole.id)) {
                await targetUser.roles.remove(upiRole);
                const revokeEmbed = new EmbedBuilder().setColor('#e74c3c').setTitle('🔒 UPI Access Revoked').setDescription(`Successfully removed **UPI KYC Access** from ${targetUser.toString()}.`);
                await message.reply({ embeds: [revokeEmbed] });
                await message.delete().catch(() => {});
            } else {
                await message.reply({ content: `⚠️ ${targetUser.user.username} doesn't have the UPI Eligible role.`, ephemeral: true });
            }
        } catch (err) {}
    }

    if (command === '!setupupidesk') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        try {
            const upiEmbed = new EmbedBuilder().setColor('#3498db').setTitle('🎥 Exclusive UPI Video KYC').setDescription(`Welcome to the Exclusive UPI Verification Desk!\n\nTo unlock exclusive **UPI Payment Methods**, please submit the following:\n\n**1. A Short Video:**\nHold your National ID (Aadhaar/PAN) near your face and clearly say: *"My name is [Your Name] and I am trading on Professor Network."*\n\n**2. Clear Photos:**\nFront & Back of your National ID.\n\n*Click the button below to create your private secure room.*`);
            const upiBtn = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('start_upi_video_kyc').setLabel('Start UPI Video KYC').setStyle(ButtonStyle.Primary).setEmoji('🎥'));
            await message.channel.send({ embeds: [upiEmbed], components: [upiBtn] });
            await message.delete().catch(()=>{});
        } catch (err) {}
    }

    if (command === '!setupdashboard') {
        if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        try {
            const dashEmbed = new EmbedBuilder().setColor('#2b2d31').setTitle('🏦 THE VAULT | EXECUTIVE DASHBOARD').setDescription('**[ 🔴 SYSTEM STATUS: STANDBY ]**\n\nClick the **Sync Network Data** button below to securely fetch the latest real-time analytics from the central database.').setFooter({ text: 'Professor Network - Secure Terminal' });
            const refreshBtn = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('refresh_dashboard').setLabel('🔄 Sync Network Data').setStyle(ButtonStyle.Primary));
            await message.channel.send({ embeds: [dashEmbed], components: [refreshBtn] });
            await message.delete().catch(()=>{});
        } catch (err) {}
    }

    if (command === '!setupleaderboard') {
        if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        try {
            let leaderboardChannel = message.guild.channels.cache.get('1506661433335746560');
            if (!leaderboardChannel) {
                leaderboardChannel = message.guild.channels.cache.find(c => c.name === '📈・weekly-recap' || c.name === 'weekly-recap');
                if (!leaderboardChannel) { leaderboardChannel = await message.guild.channels.create({ name: '📈・weekly-recap', type: ChannelType.GuildText, permissionOverwrites: [{ id: message.guild.id, deny: [PermissionsBitField.Flags.SendMessages], allow: [PermissionsBitField.Flags.ViewChannel] }, { id: client.user.id, allow: [PermissionsBitField.Flags.SendMessages] }] }); }
            }
            await message.reply({ content: `✅ Weekly Recap setup in ${leaderboardChannel}.`, ephemeral: true });
            await message.delete().catch(()=>{});
            updateWeeklyLeaderboard(message.guild);
        } catch (err) {}
    }

    if (command === '!setupheistboard') {
        if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        try {
            let heistChannel = message.guild.channels.cache.find(c => c.name === '✨・heist-points' || c.name === 'heist-leaderboard');
            if (!heistChannel) { heistChannel = await message.guild.channels.create({ name: '✨・heist-points', type: ChannelType.GuildText, permissionOverwrites: [{ id: message.guild.id, deny: [PermissionsBitField.Flags.SendMessages], allow: [PermissionsBitField.Flags.ViewChannel] }, { id: client.user.id, allow: [PermissionsBitField.Flags.SendMessages] }] }); }
            await message.reply({ content: `✅ Heist Points Leaderboard setup in ${heistChannel}.`, ephemeral: true });
            await message.delete().catch(()=>{});
            updateHeistLeaderboard(message.guild);
        } catch (err) {}
    }

    if (command === '!lockchat') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator) && !message.member.roles.cache.some(role => role.name === 'Palermo')) return;
        try {
            let verifiedRole = message.guild.roles.cache.find(r => r.name === 'Verified');
            if (verifiedRole) await message.channel.permissionOverwrites.edit(verifiedRole, { SendMessages: false });
            const lockEmbed = new EmbedBuilder().setColor('#e74c3c').setTitle('🌙 THE VAULT IS NOW RESTING').setDescription('**General Chat is now CLOSED for the night and will reopen in the morning.**\n\n🏦 **Need to Buy/Sell Crypto or Ask a Question?**\nOur Exchange Desk is fully operational! Please open a ticket here <#1503666259244482642> to proceed securely.\n\n🚨 **CRITICAL SECURITY ALERT:**\nWe **DO NOT** deal in DMs under any circumstances. Not while the chat is closed, and not while it is open. If anyone sends you a DM offering a deal, **THEY ARE A SCAMMER**. Block them immediately!').setThumbnail('https://cdn-icons-png.flaticon.com/512/2913/2913520.png').setFooter({ text: 'Professor Network - Night Mode', iconURL: client.user.displayAvatarURL() });
            await message.delete().catch(()=>{});
            await message.channel.send({ content: '@everyone 🔔 **Notice for all Verified Members**', embeds: [lockEmbed] });
        } catch (err) {}
    }

    if (command === '!openchat') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator) && !message.member.roles.cache.some(role => role.name === 'Palermo')) return;
        try {
            let verifiedRole = message.guild.roles.cache.find(r => r.name === 'Verified');
            if (verifiedRole) await message.channel.permissionOverwrites.edit(verifiedRole, { SendMessages: null });
            const unlockEmbed = new EmbedBuilder().setColor('#2ecc71').setTitle('☀️ THE VAULT IS OPEN').setDescription('Good morning, Syndicate! General chat is now **OPEN**.\n\nTrade safely, verify admins before trading, and remember: **NO DM DEALS EVER!**').setFooter({ text: 'Professor Network - Day Mode', iconURL: client.user.displayAvatarURL() });
            await message.delete().catch(()=>{});
            await message.channel.send({ content: '@everyone', embeds: [unlockEmbed] });
        } catch (err) {}
    }
});

// ==========================================
// 🖱️ INTERACTION LOGIC (BUTTONS, MODALS, SLASH CMDS)
// ==========================================
client.on('interactionCreate', async interaction => {

    if (interaction.isChatInputCommand()) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) && !interaction.member.roles.cache.some(role => role.name === 'Palermo')) {
            return interaction.reply({ content: '❌ Access Denied.', ephemeral: true });
        }

        if (interaction.commandName === 'complete') {
            await interaction.deferReply({ ephemeral: true });
            try {
                const ticketDoc = await db.collection('p2p_tickets').doc(interaction.channel.id).get();
                if (!ticketDoc.exists) return interaction.editReply({ content: "❌ This is not a valid P2P ticket." });
                
                const targetCategoryName = ticketDoc.data().tradeType === 'Buy' ? '🟢 COMPLETED BUY' : '🔴 COMPLETED SELL';
                let targetCategory = interaction.guild.channels.cache.find(c => c.name === targetCategoryName && c.type === ChannelType.GuildCategory);
                if (!targetCategory) targetCategory = await interaction.guild.channels.create({ name: targetCategoryName, type: ChannelType.GuildCategory });

                await interaction.channel.setParent(targetCategory.id, { lockPermissions: false });
                const completeEmbed = new EmbedBuilder().setColor('#2ecc71').setTitle('✅ Ticket Shifted to Queue').setDescription(`Shifted to **${targetCategoryName}**.\nIt will be fully marked as Complete tonight at 10 PM.`);
                await interaction.editReply({ embeds: [completeEmbed] });
            } catch (err) { interaction.editReply({ content: "❌ Error shifting ticket." }); }
        }

        if (interaction.commandName === 'match') {
            await interaction.deferReply({ ephemeral: true });
            try {
                const ticketDoc = await db.collection('p2p_tickets').doc(interaction.channel.id).get();
                if (!ticketDoc.exists) return interaction.editReply({ content: "❌ This is not a valid P2P ticket." });

                const targetInput = interaction.options.getString('target');
                if (!targetInput) {
                    const matchCategories = interaction.guild.channels.cache.filter(c => c.type === ChannelType.GuildCategory && c.name.startsWith('MATCH '));
                    let maxNum = 0;
                    matchCategories.forEach(cat => {
                        const num = parseInt(cat.name.replace('MATCH ', ''));
                        if (!isNaN(num) && num > maxNum) maxNum = num;
                    });
                    
                    const newCatName = `MATCH ${String(maxNum + 1).padStart(2, '0')}`;
                    const newCategory = await interaction.guild.channels.create({ name: newCatName, type: ChannelType.GuildCategory });
                    
                    await interaction.channel.setParent(newCategory.id, { lockPermissions: false });
                    const matchEmbed = new EmbedBuilder().setColor('#9b59b6').setTitle('🔗 Ticket Matched & Shifted').setDescription(`New category **${newCatName}** created.\nTicket shifted successfully!`);
                    await interaction.editReply({ embeds: [matchEmbed] });
                } else {
                    const targetCatName = targetInput.toUpperCase();
                    const targetCategory = interaction.guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === targetCatName);
                    
                    if (!targetCategory) return interaction.editReply({ content: `❌ Category **${targetCatName}** not found.` });
                    if (targetCategory.children.cache.size >= 2) return interaction.editReply({ content: `❌ **${targetCatName}** already contains 2 tickets.` });

                    await interaction.channel.setParent(targetCategory.id, { lockPermissions: false });
                    const matchEmbed = new EmbedBuilder().setColor('#9b59b6').setTitle('🔗 Ticket Shifted').setDescription(`This ticket has been successfully joined into **${targetCatName}**!`);
                    await interaction.editReply({ embeds: [matchEmbed] });
                }
            } catch (err) { interaction.editReply({ content: "❌ Error matching ticket." }); }
        }

        if (interaction.commandName === 'unmatch') {
            await interaction.deferReply({ ephemeral: true });
            try {
                const ticketDoc = await db.collection('p2p_tickets').doc(interaction.channel.id).get();
                if (!ticketDoc.exists) return interaction.editReply({ content: "❌ This is not a valid P2P ticket." });

                const parentCat = interaction.channel.parent;
                if (!parentCat || !parentCat.name.startsWith('MATCH ')) return interaction.editReply({ content: "❌ This ticket is not inside a MATCH category." });

                const targetCategoryName = ticketDoc.data().tradeType === 'Buy' ? '🟢 BUY TICKETS' : '🔴 SELL TICKETS';
                let targetCategory = interaction.guild.channels.cache.find(c => c.name === targetCategoryName && c.type === ChannelType.GuildCategory);
                if (!targetCategory) targetCategory = await interaction.guild.channels.create({ name: targetCategoryName, type: ChannelType.GuildCategory });

                await interaction.channel.setParent(targetCategory.id, { lockPermissions: false });
                const unmatchEmbed = new EmbedBuilder().setColor('#e74c3c').setTitle('💔 Ticket Unmatched').setDescription(`Ticket moved back to **${targetCategoryName}**.`);
                await interaction.editReply({ embeds: [unmatchEmbed] });

                if (parentCat.children.cache.size === 0) await parentCat.delete().catch(()=>{});
            } catch (err) { interaction.editReply({ content: "❌ Error unmatching ticket." }); }
        }
        return; 
    }

    if (interaction.isButton() && interaction.customId === 'refresh_dashboard') {
        await interaction.deferUpdate(); 
        try {
            const liveMembers = interaction.guild.memberCount;
            const snapshot = await db.collection('p2p_tickets').where('status', '==', 'Completed').get();
            let dailyVol = 0, weeklyVol = 0, monthlyVol = 0;
            const userVolumes = {};
            const now = new Date();

            snapshot.forEach(doc => {
                const data = doc.data();
                const amount = data.amountUsd || 0;
                const userTag = data.discordUserId ? `<@${data.discordUserId}>` : `@${data.username || 'Unknown'}`;
                userVolumes[userTag] = (userVolumes[userTag] || 0) + amount;

                if (data.closedAt && typeof data.closedAt.toDate === 'function') {
                    const diffDays = Math.ceil(Math.abs(now - data.closedAt.toDate()) / (1000 * 60 * 60 * 24)); 
                    if (diffDays <= 1) dailyVol += amount;
                    if (diffDays <= 7) weeklyVol += amount;
                    if (diffDays <= 30) monthlyVol += amount;
                }
            });

            const topTraders = Object.keys(userVolumes).map(tag => ({ tag, totalVolume: userVolumes[tag] })).sort((a, b) => b.totalVolume - a.totalVolume).slice(0, 5);
            let whalesText = topTraders.length === 0 ? 'No data available yet.' : topTraders.map((trader, i) => `${['🥇', '🥈', '🥉', '🏅', '🏅'][i]} ${trader.tag} ━━ **$${trader.totalVolume}**`).join('\n');

            const updatedDashEmbed = new EmbedBuilder().setColor('#2ecc71').setTitle('🏦 THE VAULT | EXECUTIVE DASHBOARD').setDescription('**[ 🟢 SYSTEM STATUS: ONLINE ]**\nReal-time network analytics securely fetched from the central database.').addFields({ name: '👥 Network Strength', value: `\`\`\`yaml\nTotal Live Members : ${liveMembers}\n\`\`\``, inline: false }, { name: '📈 Transaction Analytics', value: `\`\`\`yaml\nDaily (24h)   : $${dailyVol}\nWeekly (7d)   : $${weeklyVol}\nMonthly (30d) : $${monthlyVol}\n\`\`\``, inline: false }, { name: '🏆 Top 5 Network Whales', value: whalesText, inline: false }).setTimestamp().setFooter({ text: 'Professor Network - Secure Terminal', iconURL: client.user.displayAvatarURL() });
            await interaction.editReply({ embeds: [updatedDashEmbed] });
        } catch (error) { await interaction.followUp({ content: '❌ Data fetch karne mein error aaya!', ephemeral: true }); }
    }

    if (interaction.isButton() && interaction.customId === 'open_flash_modal') {
        const modal = new ModalBuilder().setCustomId('submit_flash_deal').setTitle('Publish Flash Deal');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('deal_msg').setLabel("Deal Message (ex: USDT is now 88 INR!)").setStyle(TextInputStyle.Paragraph).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('deal_hours').setLabel("Valid for how many hours? (ex: 2 or 2.5)").setStyle(TextInputStyle.Short).setRequired(true)));
        await interaction.showModal(modal); 
        await interaction.message.delete().catch(() => {});
    }

    if (interaction.isModalSubmit() && interaction.customId === 'submit_flash_deal') {
        const msg = interaction.fields.getTextInputValue('deal_msg');
        const hours = parseFloat(interaction.fields.getTextInputValue('deal_hours'));
        if (isNaN(hours)) return interaction.reply({ content: '❌ Put Number Only.', ephemeral: true });
        const endTime = Math.floor(Date.now() / 1000) + (hours * 60 * 60);
        const flashEmbed = new EmbedBuilder().setTitle('🚨 MEGA FLASH DEAL 🚨').setDescription(`**${msg}**\n\n━━━━━━━━━━━━━━━━━━━━\n⏰ **Exact End Time:** <t:${endTime}:T>\n⏳ **Countdown:** <t:${endTime}:R>\n━━━━━━━━━━━━━━━━━━━━`).setColor('#ff0000').setFooter({ text: 'Professor Network-Trusted P2P', iconURL: client.user.displayAvatarURL() });
        await interaction.reply({ content: '✅ Deal Successfully Posted!', ephemeral: true });
        await interaction.channel.send({ content: '@everyone', embeds: [flashEmbed] });
    }

    if (interaction.isButton() && interaction.customId === 'open_poll_modal') {
        const modal = new ModalBuilder().setCustomId('submit_poll_modal').setTitle('Create Community Poll');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('poll_q').setLabel("Poll Question").setStyle(TextInputStyle.Paragraph).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('poll_o1').setLabel("Option 1").setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('poll_o2').setLabel("Option 2").setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('poll_o3').setLabel("Option 3 (Optional)").setStyle(TextInputStyle.Short).setRequired(false)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('poll_o4').setLabel("Option 4 (Optional)").setStyle(TextInputStyle.Short).setRequired(false))
        );
        await interaction.showModal(modal);
        await interaction.message.delete().catch(() => {});
    }

    if (interaction.isModalSubmit() && interaction.customId === 'submit_poll_modal') {
        const question = interaction.fields.getTextInputValue('poll_q');
        const opt1 = interaction.fields.getTextInputValue('poll_o1');
        const opt2 = interaction.fields.getTextInputValue('poll_o2');
        const opt3 = interaction.fields.getTextInputValue('poll_o3');
        const opt4 = interaction.fields.getTextInputValue('poll_o4');

        let description = `**${question}**\n\n`;
        const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'];
        const options = [opt1, opt2];
        if (opt3) options.push(opt3);
        if (opt4) options.push(opt4);

        options.forEach((opt, index) => { description += `${emojis[index]} **${opt}**\n\n`; });
        const pollEmbed = new EmbedBuilder().setColor('#3498db').setAuthor({ name: '📊 Professor Network Community Poll', iconURL: client.user.displayAvatarURL() }).setDescription(description).setFooter({ text: 'Cast your vote by reacting below! 👇' }).setTimestamp();
        let pollChannel = interaction.guild.channels.cache.find(c => c.name === '💬・p2p-chat');

        if (!pollChannel) return interaction.reply({ content: '❌ Error: `💬・p2p-chat` naam ka channel nahi mila!', ephemeral: true });
        
        await interaction.reply({ content: `✅ Poll successfully sent to ${pollChannel}!`, ephemeral: true });
        const pollMessage = await pollChannel.send({ content: '@everyone', embeds: [pollEmbed] });
        for (let i = 0; i < options.length; i++) { await pollMessage.react(emojis[i]); }
    }

    if (interaction.isButton() && interaction.customId.startsWith('confirm_feedback_')) {
        const expectedUserId = interaction.customId.replace('confirm_feedback_', '');
        if (interaction.user.id !== expectedUserId) return interaction.reply({ content: '❌ Action Denied.', ephemeral: true });
        await interaction.deferUpdate();

        const messages = await interaction.channel.messages.fetch({ limit: 15 });
        const userMessages = messages.filter(m => m.author.id === expectedUserId);
        let reviewText = "", imageAttachment = null;

        userMessages.forEach(m => {
            if (m.content.trim() !== '' && reviewText === "") reviewText = m.content;
            if (m.attachments.size > 0 && !imageAttachment) imageAttachment = m.attachments.first();
        });

        if (reviewText === "" && !imageAttachment) return interaction.followUp({ content: '⚠️ Please write a message or upload a screenshot before clicking Confirm!', ephemeral: true });
        if (reviewText === "") reviewText = "Awesome and fast trade! 🚀";

        let reviewChannel = interaction.guild.channels.cache.find(c => c.name === '⭐・transaction-reviews' || c.name.includes('transaction-reviews'));
        if (!reviewChannel) {
            reviewChannel = await interaction.guild.channels.create({ name: '⭐・transaction-reviews', type: ChannelType.GuildText, permissionOverwrites: [{ id: interaction.guild.id, allow: [PermissionsBitField.Flags.ViewChannel], deny: [PermissionsBitField.Flags.SendMessages] }, { id: client.user.id, allow: [PermissionsBitField.Flags.SendMessages] }] });
        }

        const reviewEmbed = new EmbedBuilder().setColor('#f1c40f').setAuthor({ name: `${interaction.user.username}'s Feedback`, iconURL: interaction.user.displayAvatarURL() }).setDescription(`💬 **Review:**\n> ${reviewText}`).addFields({ name: '🔄 Trade Info', value: `\`${interaction.channel.topic || "P2P Trade"}\``, inline: true }).setTimestamp().setFooter({ text: '💎 Professor Network - Trusted P2P', iconURL: client.user.displayAvatarURL() });
        let filesToUpload = [];
        if (imageAttachment) {
            const proofImage = new AttachmentBuilder(imageAttachment.url, { name: 'feedback-proof.png' });
            reviewEmbed.setImage('attachment://feedback-proof.png');
            filesToUpload.push(proofImage);
        }

        await reviewChannel.send({ content: `🔔 **New Transaction Review!** | @everyone`, embeds: [reviewEmbed], files: filesToUpload });
        await interaction.followUp({ content: '✅ Your feedback has been published! Closing room...', ephemeral: true });
        setTimeout(() => interaction.channel.delete().catch(()=> {}), 5000);
    }
    
    if (interaction.isButton() && interaction.customId === 'start_kyc_form') {
        const existingKyc = await db.collection('users_kyc').doc(interaction.user.id).get();
        if (existingKyc.exists && existingKyc.data().basicVerified) {
            let basicRole = interaction.guild.roles.cache.find(r => r.name === 'Verified');
            if (basicRole && !interaction.member.roles.cache.has(basicRole.id)) {
                await interaction.member.roles.add(basicRole).catch(console.error);
            }
            return interaction.reply({ content: '✅ **You Are Already Verified!**', ephemeral: true });
        }

        const kycModal = new ModalBuilder().setCustomId('submit_kyc_modal').setTitle('🛡️ Instant Verification Form');
        kycModal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('kyc_name').setLabel('Full Name / Alias').setStyle(TextInputStyle.Short).setRequired(true)), 
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('kyc_discord_contact').setLabel('Discord ID / Name').setStyle(TextInputStyle.Short).setValue(interaction.user.username).setRequired(true)), 
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('welcome_message').setLabel('🙏 Welcome To Professor Network').setStyle(TextInputStyle.Paragraph).setValue('💎 Trusted P2P Platform For Usdt Buy/Sell').setRequired(false))
        );
        await interaction.showModal(kycModal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'submit_kyc_modal') {
        await interaction.deferReply({ ephemeral: true });
        try {
            const existingKyc = await db.collection('users_kyc').doc(interaction.user.id).get();
            if (existingKyc.exists && existingKyc.data().basicVerified) {
                return interaction.editReply({ content: `✅ **You Are Already Verified!**` });
            }
            
            await db.collection('users_kyc').doc(interaction.user.id).set({ discordId: interaction.user.id, username: interaction.user.username, name: interaction.fields.getTextInputValue('kyc_name'), discordContact: interaction.fields.getTextInputValue('kyc_discord_contact'), paymentInfo: 'N/A', basicVerified: true, createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
            
            let basicRole = interaction.guild.roles.cache.find(r => r.name === 'Verified');
            if (!basicRole) basicRole = await interaction.guild.roles.create({ name: 'Verified', color: '#3498db' });
            await interaction.member.roles.add(basicRole).catch(console.error);
            globalLastUpdate = Date.now(); 
            await interaction.editReply({ content: '✅ **Registration Successful!** You have received the **Verified** role.\n*(Note: To get the **Vault Verified** tag, Select "P2P With KYC" at the Exchange Desk).*' });
        } catch (error) { await interaction.editReply({ content: '❌ Error saving data.' }); }
    }

    if (interaction.isButton() && interaction.customId === 'start_p2p_trade') {
        const modeEmbed = new EmbedBuilder().setColor('#3498db').setAuthor({ name: '🏦 P2P Trade Setup | Mode Selection', iconURL: client.user.displayAvatarURL() }).setDescription('Please choose your trade mode:\n\n🛡️ **P2P With KYC:** $0 Fee (Requires Vault Verified tag)\n💸 **P2P Without KYC:** $3 Fee (Instant, No ID required)');
        const modeButtons = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('start_p2p_with_kyc').setLabel('🛡️ P2P With KYC').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('start_p2p_without_kyc').setLabel('💸 P2P Without KYC').setStyle(ButtonStyle.Secondary));
        await interaction.reply({ embeds: [modeEmbed], components: [modeButtons], ephemeral: true });
    }

    if (interaction.isButton() && (interaction.customId === 'start_p2p_with_kyc' || interaction.customId === 'start_p2p_without_kyc')) {
        const isVerifiedRoute = interaction.customId === 'start_p2p_with_kyc';
        const hasRole = interaction.member.roles.cache.some(role => role.name === 'Vault Verified');

        if (isVerifiedRoute && !hasRole) {
            return interaction.reply({ 
                content: '❌ **Access Denied:** You need the **Vault Verified** role to use the $0 Fee route.\n\n👉 Please visit the designated <#1511636240729116773> channel and click the button to get your identity verified first.', 
                ephemeral: true 
            });
        }
        userSelections.set(interaction.user.id, { type: null, step2: null, step3: null, amount: null, isVerifiedTrade: isVerifiedRoute });
        const typeDropdown = new StringSelectMenuBuilder().setCustomId('dropdown_type').setPlaceholder('Select Action: Buy or Sell').addOptions([
            { label: 'Buy USDT (Pay INR)', value: 'Buy', emoji: { id: '1521708980647231648' } }, 
            { label: 'Sell USDT (Get INR)', value: 'Sell', emoji: { id: '1521709256947269803' } }
        ]);
        const step1Embed = new EmbedBuilder().setColor('#3498db').setAuthor({ name: '🏦 P2P Trade Setup | Step 1', iconURL: client.user.displayAvatarURL() }).setDescription(`**Mode:** ${isVerifiedRoute ? '✅ KYC ($0 Fee)' : '⚠️ Non-KYC (Up to $3 Fee)'}\n\nPlease select whether you want to **Buy** or **Sell** Crypto from the dropdown below.`);
        await interaction.update({ content: '', embeds: [step1Embed], components: [new ActionRowBuilder().addComponents(typeDropdown)] });
    }

    if (interaction.isButton() && interaction.customId === 'start_upi_video_kyc') {
        try {
            const existingChannel = interaction.guild.channels.cache.find(c => c.name.startsWith('upi-') && c.topic === interaction.user.id);
            if (existingChannel) { return interaction.reply({ content: `❌ **Action Denied:** Your UPI Video KYC is already in progress.\n\n👉 **Head over to your open room here:** ${existingChannel}`, ephemeral: true }); }
        } catch (err) {}

        await interaction.reply({ content: '⏳ Creating your secure UPI Video KYC room...', ephemeral: true });

        try {
            let kycCategory = interaction.guild.channels.cache.get('1520318957863829565');
            if (!kycCategory) { kycCategory = interaction.guild.channels.cache.find(c => (c.name === '📢 KYC REQUESTS' || c.name === 'KYC REQUESTS') && c.type === ChannelType.GuildCategory); }

            const palermoRole = interaction.guild.roles.cache.find(role => role.name === 'Palermo');
            const channelPermissions = [
                { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }, 
                { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles] }
            ];
            if (palermoRole) channelPermissions.push({ id: palermoRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] });

            const randomKycId = Math.random().toString(36).substring(2, 8);
            
            const upiKycChannel = await interaction.guild.channels.create({ 
                name: `upi-${randomKycId}`, type: ChannelType.GuildText, parent: kycCategory ? kycCategory.id : null, permissionOverwrites: channelPermissions, topic: interaction.user.id 
            });

            const upiEmbed = new EmbedBuilder().setColor('#3498db').setAuthor({ name: '🎥 VIP UPI Video Verification', iconURL: client.user.displayAvatarURL() }).setDescription(`Welcome ${interaction.user.toString()}!\n\nTo unlock exclusive **UPI Payment Methods**, please submit the following:\n\n**1. A Short Video:**\nHold your National ID (Aadhaar/PAN) near your face and clearly say: *"My name is [Your Name] and I am trading on Professor Network."*\n\n**2. Clear Photos:**\nFront & Back of your National ID.\n\n*Upload the video and images directly in this chat. Our Admin will review them and save them securely to the Firebase Cloud Vault.*`).setFooter({ text: 'Professor Network - Secure UPI Terminal' });            

            const upiAdminButtons = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`approve_upikyc_${interaction.user.id}`).setLabel('✅ Approve UPI KYC').setStyle(ButtonStyle.Success), 
                new ButtonBuilder().setCustomId(`reject_upikyc_${interaction.user.id}`).setLabel('❌ Reject').setStyle(ButtonStyle.Danger)
            );

            await upiKycChannel.send({ content: `🔔 Admin Notification: VIP UPI Video KYC Pending for ${interaction.user.toString()}`, embeds: [upiEmbed], components: [upiAdminButtons] });
            await interaction.editReply({ content: `✅ VIP Room created! Please head over to ${upiKycChannel} to submit your video and documents.` });
        } catch (error) { await interaction.editReply({ content: '❌ Room create karne mein error aaya. Permissions check karein.' }); }
    }

    if (interaction.isButton() && interaction.customId.startsWith('approve_upikyc_')) {
        const userId = interaction.customId.replace('approve_upikyc_', '');
        const isPalermo = interaction.member.roles.cache.some(role => role.name === 'Palermo');
        const isProfessor = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
        
        if (!isProfessor && !isPalermo) return interaction.reply({ content: '❌ **Access Denied.**', ephemeral: true });

        await interaction.deferUpdate(); 
        await interaction.followUp({ content: '⏳ Downloading media and securely uploading to Firebase Storage... Please wait.', ephemeral: true });
        
        try {
            const messages = await interaction.channel.messages.fetch({ limit: 50 });
            let attachments = [];
            messages.forEach(msg => { msg.attachments.forEach(att => attachments.push(att)); });

            if (attachments.length === 0) return interaction.followUp({ content: '⚠️ Error: No video or photo found from the user! Please ask them to upload before approving.', ephemeral: true });

            let uploadedUrls = [];
            for (const att of attachments) {
                const response = await axios.get(att.url, { responseType: 'arraybuffer' });
                const buffer = Buffer.from(response.data);
                const filePath = `upi_video_kyc/${userId}/${Date.now()}_${att.name}`;
                const file = bucket.file(filePath); 
                
                await file.save(buffer, { contentType: att.contentType, metadata: { cacheControl: 'public, max-age=31536000' } });
                const [downloadUrl] = await file.getSignedUrl({ action: 'read', expires: '01-01-2099' });
                uploadedUrls.push(downloadUrl);
            }

            await db.collection('users_kyc').doc(userId).set({ 
                upiVerified: true, upiMediaUrls: uploadedUrls, upiApprovedBy: interaction.user.username, upiUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            const targetMember = await interaction.guild.members.fetch(userId).catch(()=>null);
            if(targetMember) {
                 let verifiedRole = interaction.guild.roles.cache.find(r => r.name === 'UPI Verified');
                 if (!verifiedRole) verifiedRole = await interaction.guild.roles.create({ name: 'UPI Verified', color: '#9b59b6' }); 
                 await targetMember.roles.add(verifiedRole);
                 await targetMember.send({ embeds: [new EmbedBuilder().setColor('#2ecc71').setTitle('🎥 UPI Verification Successful').setDescription('Your UPI Video KYC has been approved!\n\nYou can now use UPI payment methods for trading in Professor Network.')] }).catch(()=>{});
            }

            await interaction.editReply({ embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setColor('#2ecc71').setTitle('✅ UPI KYC Approved')], components: [] });
            await interaction.followUp({ content: `✅ Successfully verified <@${userId}>! Files saved to Firebase securely. Room closing in 5 seconds...`, ephemeral: true });
            setTimeout(() => interaction.channel.delete().catch(()=>{}), 5000);

        } catch (error) { await interaction.followUp({ content: '❌ Error: Failed to upload files to Firebase. Please check the bot console.', ephemeral: true }); }
    }

    if (interaction.isButton() && interaction.customId.startsWith('reject_upikyc_')) {
        const userId = interaction.customId.replace('reject_upikyc_', '');
        const isPalermo = interaction.member.roles.cache.some(role => role.name === 'Palermo');
        const isProfessor = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
        if (!isProfessor && !isPalermo) return interaction.reply({ content: '❌ **Access Denied.**', ephemeral: true });

        await interaction.deferUpdate();
        await interaction.editReply({ embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setColor('#e74c3c').setTitle('❌ UPI KYC Rejected')], components: [] });
        await interaction.followUp({ content: `❌ UPI KYC Rejected for <@${userId}>. Room will close in 5 seconds.`, ephemeral: true });
        
        const targetMember = await interaction.guild.members.fetch(userId).catch(()=>null);
        if(targetMember) {
             await targetMember.send({ embeds: [new EmbedBuilder().setColor('#e74c3c').setTitle('❌ UPI Verification Failed').setDescription('Your UPI Video KYC has been rejected by Admin.\n\nPlease ensure your video and IDs are clear and try again.')] }).catch(()=>{});
        }
        setTimeout(() => interaction.channel.delete().catch(()=>{}), 5000);
    }
      
    if (interaction.isButton() && interaction.customId === 'start_advanced_kyc') {
        const hasRole = interaction.member.roles.cache.some(role => role.name === 'Vault Verified');
        if (hasRole) return interaction.reply({ content: '✅ **You are already Vault Verified!** No need to do this again.', ephemeral: true });

        try {
            const existingChannel = interaction.guild.channels.cache.find(c => c.name.startsWith('kyc-') && c.topic === interaction.user.id);
            if (existingChannel) return interaction.reply({ content: `❌ **Action Denied:** Your KYC verification is already in progress.\n\n👉 **Head over to your open room here:** ${existingChannel}`, ephemeral: true });
        } catch (err) {}

        await interaction.reply({ content: '⏳ Creating your secure KYC verification room...', ephemeral: true });

        try {
            let kycCategory = interaction.guild.channels.cache.find(c => (c.name === '📢 KYC REQUESTS' || c.name === 'KYC REQUESTS') && c.type === ChannelType.GuildCategory);
            if (!kycCategory) kycCategory = await interaction.guild.channels.create({ name: '📢 KYC REQUESTS', type: ChannelType.GuildCategory });

            const palermoRole = interaction.guild.roles.cache.find(role => role.name === 'Palermo');
            const channelPermissions = [
                { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }, 
                { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles] }
            ];
            if (palermoRole) channelPermissions.push({ id: palermoRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] });

            const randomKycId = Math.random().toString(36).substring(2, 8);
            const kycChannel = await interaction.guild.channels.create({ 
                name: `kyc-${randomKycId}`, type: ChannelType.GuildText, parent: kycCategory.id, permissionOverwrites: channelPermissions, topic: interaction.user.id 
            });

            const kycEmbed = new EmbedBuilder().setColor('#3498db').setAuthor({ name: '🛡️ Advanced KYC Verification', iconURL: client.user.displayAvatarURL() }).setDescription(`Welcome ${interaction.user.toString()}!\n\nTo unlock **$0 Fee Trades (P2P With KYC)**, we need to verify your real identity.\n\nPlease upload:\n# 📸 A clear photo of your Aadhaar(Front & Back) And PAN Card(Front)\n\nSend the image directly in this chat. Our Admin will review it shortly.`).setFooter({ text: 'Professor Network - Secure KYC' });            
            const kycAdminButtons = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`approve_kyc_${interaction.user.id}`).setLabel('✅ Approve KYC').setStyle(ButtonStyle.Success), 
                new ButtonBuilder().setCustomId(`reject_kyc_${interaction.user.id}`).setLabel('❌ Reject KYC').setStyle(ButtonStyle.Danger)
            );

            await kycChannel.send({ content: `🔔 Admin Notification: New Advanced KYC Pending for ${interaction.user.toString()}`, embeds: [kycEmbed], components: [kycAdminButtons] });
            await interaction.editReply({ content: `✅ KYC Room created! Please head over to ${kycChannel} to submit your documents.` });
        } catch (error) { await interaction.editReply({ content: '❌ Room create karne mein error aaya.' }); }
    }

    if (interaction.isButton() && interaction.customId.startsWith('approve_kyc_')) {
        const userId = interaction.customId.replace('approve_kyc_', '');
        const isPalermo = interaction.member.roles.cache.some(role => role.name === 'Palermo');
        const isProfessor = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
        if (!isProfessor && !isPalermo) return interaction.reply({ content: '❌ **Access Denied.**', ephemeral: true });

        await interaction.deferUpdate(); 
        await interaction.followUp({ content: '⏳ Saving photos to secure database... Please wait.', ephemeral: true });
        
        const messages = await interaction.channel.messages.fetch({ limit: 50 });
        let attachments = [];
        messages.forEach(msg => { msg.attachments.forEach(att => attachments.push(att.url)); });

        let uploadedPhotos = [];
        for (let i = 0; i < Math.min(attachments.length, 5); i++) {
            let url = await uploadImageToFirebase(attachments[i], userId, `Doc_${i+1}`);
            if (url) uploadedPhotos.push(url);
        }

        await db.collection('users_kyc').doc(userId).set({ photos: uploadedPhotos }, { merge: true }).catch(err => console.error(err));
        await approveUserKYC(userId, interaction.guild);
        
        await interaction.editReply({ embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setColor('#2ecc71').setTitle('✅ KYC Approved')], components: [] });
        await interaction.followUp({ content: `✅ Successfully verified <@${userId}>! They received the Vault Verified role. This room will close in 5 seconds.`, ephemeral: true });
        
        const exchangeChannel = interaction.guild.channels.cache.get('1503666259244482642');        
        if (exchangeChannel) {
            try {
                const fetchedMessages = await exchangeChannel.messages.fetch({ limit: 10 });
                fetchedMessages.filter(m => m.author.id === client.user.id).forEach(msg => msg.delete().catch(()=>{}));
                const setupEmbed = new EmbedBuilder().setColor('#2b2d31').setTitle('🏦 Exchange Desk (P2P)').setDescription('Welcome to the Professor Network.\n\nClick the button below to start trading securely.').setFooter({ text: 'Automated by Professor Network' });
                await exchangeChannel.send({ embeds: [setupEmbed], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('start_p2p_trade').setLabel('🚀 Start Trade').setStyle(ButtonStyle.Primary))] });
            } catch (err) {}
        }
        if (interaction.channel.name.startsWith('kyc-') && interaction.channel.name !== 'kyc-requests') setTimeout(() => interaction.channel.delete().catch(()=>{}), 5000);
    }

    if (interaction.isButton() && interaction.customId.startsWith('reject_kyc_')) {
        const userId = interaction.customId.replace('reject_kyc_', '');
        const isPalermo = interaction.member.roles.cache.some(role => role.name === 'Palermo');
        const isProfessor = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
        if (!isProfessor && !isPalermo) return interaction.reply({ content: '❌ **Access Denied.**', ephemeral: true });

        await interaction.deferUpdate();
        await interaction.editReply({ embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setColor('#e74c3c').setTitle('❌ KYC Rejected')], components: [] });
        await interaction.followUp({ content: `❌ KYC Rejected for <@${userId}>. This room will close in 5 seconds.`, ephemeral: true });
        if (interaction.channel.name.startsWith('kyc-') && interaction.channel.name !== 'kyc-requests') setTimeout(() => interaction.channel.delete().catch(()=>{}), 5000);
    }

    if (interaction.isStringSelectMenu()) {
        const userState = userSelections.get(interaction.user.id) || { type: null, step2: null, step3: null, amount: null, isVerifiedTrade: false };
        
        if (interaction.customId === 'dropdown_type') {
            userState.type = interaction.values[0]; userState.step2 = null; userState.step3 = null; userState.amount = null;
            userSelections.set(interaction.user.id, userState);
            const amountModal = new ModalBuilder().setCustomId('amount_modal_popup').setTitle(`🏦 Trade Amount (${userState.type} Crypto)`);
            amountModal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('trade_amount_input').setLabel(userState.type === 'Buy' ? 'Enter Amount in USDT ($) - minimum 100$' : 'Enter Amount in USDT ($) - minimum 50$').setPlaceholder('e.g. 5000').setStyle(TextInputStyle.Short).setRequired(true)));
            return interaction.showModal(amountModal);
        }
        
        if (interaction.customId === 'dropdown_step2' || interaction.customId === 'dropdown_step3') {
            if (interaction.customId === 'dropdown_step2') { userState.step2 = interaction.values[0]; userState.step3 = null; } 
            else { userState.step3 = interaction.values[0]; }
            userSelections.set(interaction.user.id, userState);
            
            const typeDropdown = new StringSelectMenuBuilder().setCustomId('dropdown_type').addOptions([
                { label: 'Buy USDT (Pay INR)', value: 'Buy', emoji: { id: '1521708980647231648' }, default: userState.type === 'Buy' }, 
                { label: 'Sell USDT (Get INR)', value: 'Sell', emoji: { id: '1521709256947269803' }, default: userState.type === 'Sell' }
            ]);
            const step2Dropdown = new StringSelectMenuBuilder().setCustomId('dropdown_step2');
            
            let estTimes = { 'imps/UPI' : '2 Hour', 'cdm': '45 Minutes to 1 Hour' };
            try {
                const setDoc = await db.collection('settings').doc('app_data').get();
                if (setDoc.exists && setDoc.data().estTimes) estTimes = setDoc.data().estTimes;
            } catch(e){}

            if (userState.type === 'Sell') {
                step2Dropdown.addOptions([
                    { label: 'USDT Trc20', value: 'TRC20', emoji: '🔗', default: userState.step2 === 'TRC20' }, 
                    { label: 'USDT Erc20', value: 'ERC20', emoji: '💎', default: userState.step2 === 'ERC20' }, 
                    { label: 'USDT Bep20', value: 'BEP20', emoji: '🟡', default: userState.step2 === 'BEP20' }, 
                    { label: 'USDT Arbitrum', value: 'ARBITRUM', emoji: '🔵', default: userState.step2 === 'ARBITRUM' },
                    { label: 'USDC Erc20', value: 'USDC_ERC20', emoji: '🪙', default: userState.step2 === 'USDC_ERC20' },
                    { label: 'USDC Bep20', value: 'USDC_BEP20', emoji: '🪙', default: userState.step2 === 'USDC_BEP20' }
                ]);           
             } else {
                step2Dropdown.addOptions([
                    { label: 'CCW (ICICI, SBI)', value: 'CCW', emoji: '💳', default: userState.step2 === 'CCW' }, 
                    { label: 'Cash Deposit (CDM)', value: 'CDM', emoji: '🏧', default: userState.step2 === 'CDM' }
                ]);
            }
            
            const components = [new ActionRowBuilder().addComponents(typeDropdown), new ActionRowBuilder().addComponents(step2Dropdown)];
            const stepEmbed = new EmbedBuilder().setColor('#3498db').addFields({ name: '🔄 Action', value: `${userState.type === 'Buy' ? '<:buy_sign:1521708980647231648> Buy USDT' : '<:sell_sign:1521709256947269803> Sell USDT'}`, inline: true }, { name: '💰 Amount', value: `$${userState.amount}`, inline: true }, { name: '🌐 Network/Method', value: `${userState.step2 || 'Pending'}`, inline: true });
            
            if (userState.type === 'Sell') {
                const step3Dropdown = new StringSelectMenuBuilder()
                    .setCustomId('dropdown_step3')
                    .setPlaceholder('Select Receiving Method')
                    .addOptions([
                        { label: 'IMPS/UPI', description: `Estimated Time ${estTimes['imps/UPI']}`, value: 'IMPS/UPI', emoji: '🏦', default: userState.step3 === 'IMPS/UPI' }, 
                        { label: 'CDM (Cash Deposit)', description: `Estimated Time ${estTimes['cdm']}`, value: 'CDM', emoji: '🏧', default: userState.step3 === 'CDM' },
                    ]);
                components.push(new ActionRowBuilder().addComponents(step3Dropdown));

                if (userState.step3) {
                    components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('proceed_to_details').setLabel('Next (Enter Bank Details)').setStyle(ButtonStyle.Success)));
                    stepEmbed.setAuthor({ name: '🏦 P2P Trade Setup | Final Step', iconURL: client.user.displayAvatarURL() })
                        .setColor('#2ecc71')
                        .setDescription('Click the **Next** button below to securely enter your bank details.')
                        .addFields({ name: '🏦 Receiving Method', value: `${userState.step3 === 'CCW' ? 'CCW (ICICI, SBI)' : userState.step3}`, inline: true });
                } else {
                    stepEmbed.setAuthor({ name: '🏦 P2P Trade Setup | Step 3', iconURL: client.user.displayAvatarURL() })
                        .setDescription('Please select how you want to receive your INR from the dropdown below.');
                }
            } else {
                const step3Dropdown = new StringSelectMenuBuilder()
                    .setCustomId('dropdown_step3')
                    .setPlaceholder('Select Crypto Network')
                    .addOptions([
                        { label: 'USDT Trc20', value: 'TRC20', emoji: '🔗', default: userState.step3 === 'TRC20' }, 
                        { label: 'USDT Erc20', value: 'ERC20', emoji: '💎', default: userState.step3 === 'ERC20' }, 
                        { label: 'USDT Bep20', value: 'BEP20', emoji: '🟡', default: userState.step3 === 'BEP20' }, 
                        { label: 'USDT Arbitrum', value: 'ARBITRUM', emoji: '🔵', default: userState.step3 === 'ARBITRUM' },
                        { label: 'USDC Erc20', value: 'USDC_ERC20', emoji: '🪙', default: userState.step3 === 'USDC_ERC20' },
                        { label: 'USDC Bep20', value: 'USDC_BEP20', emoji: '🪙', default: userState.step3 === 'USDC_BEP20' }
                    ]);
                components.push(new ActionRowBuilder().addComponents(step3Dropdown));

                if (userState.step3) {
                    components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('proceed_to_details').setLabel(`Next (Enter ${userState.step3} Wallet)`).setStyle(ButtonStyle.Success)));
                    stepEmbed.setAuthor({ name: '🏦 P2P Trade Setup | Final Step', iconURL: client.user.displayAvatarURL() })
                        .setColor('#2ecc71')
                        .setDescription('Click the **Next** button below to securely enter your wallet details.')
                        .addFields({ name: '🔗 Receiving Network', value: userState.step3, inline: true });
                } else {
                    stepEmbed.setAuthor({ name: '🏦 P2P Trade Setup | Step 3', iconURL: client.user.displayAvatarURL() })
                        .setDescription('Please select the crypto network on which you want to receive your USDT.');
                }
            }
            await interaction.update({ content: '', embeds: [stepEmbed], components });
        }
    }

    if (interaction.isModalSubmit() && interaction.customId === 'amount_modal_popup') {
        const userState = userSelections.get(interaction.user.id);
        const numericAmount = Number(interaction.fields.getTextInputValue('trade_amount_input'));
        if (isNaN(numericAmount) || numericAmount <= 0) return interaction.reply({ content: '❌ **Invalid Amount!**', ephemeral: true });
        if (userState.type === 'Buy' && numericAmount < 100) return interaction.reply({ content: '❌ **Minimum Limit Alert:** Buy USDT is **$100**.', ephemeral: true });
        if (userState.type === 'Sell' && numericAmount < 50) return interaction.reply({ content: '❌ **Minimum Limit Alert:** Sell USDT is **$50**.', ephemeral: true });

        userState.amount = interaction.fields.getTextInputValue('trade_amount_input');
        userSelections.set(interaction.user.id, userState);

        const typeDropdown = new StringSelectMenuBuilder().setCustomId('dropdown_type').addOptions([
            { label: 'Buy USDT (Pay INR)', value: 'Buy', emoji: { id: '1521708980647231648' }, default: userState.type === 'Buy' }, 
            { label: 'Sell USDT (Get INR)', value: 'Sell', emoji: { id: '1521709256947269803' }, default: userState.type === 'Sell' }
        ]);
        const step2Dropdown = new StringSelectMenuBuilder().setCustomId('dropdown_step2');
        
        if (userState.type === 'Sell') {
            step2Dropdown.setPlaceholder('Select Crypto Network').addOptions([
                { label: 'USDT Trc20', value: 'TRC20', emoji: '🔗' }, 
                { label: 'USDT Erc20', value: 'ERC20', emoji: '💎' }, 
                { label: 'USDT Bep20', value: 'BEP20', emoji: '🟡' }, 
                { label: 'USDT Arbitrum', value: 'ARBITRUM', emoji: '🔵' },
                { label: 'USDC Erc20', value: 'USDC_ERC20', emoji: '🪙' },
                { label: 'USDC Bep20', value: 'USDC_BEP20', emoji: '🪙' }
            ]);     
        } else {
            step2Dropdown.setPlaceholder('Choose Payment Method').addOptions([
                { label: 'CCW (ICICI, SBI)', value: 'CCW', emoji: '💳' }, 
                { label: 'Cash Deposit (CDM)', value: 'CDM', emoji: '🏧' }
            ]);
        }

        const step2Embed = new EmbedBuilder().setColor('#3498db').setAuthor({ name: '🏦 P2P Trade Setup | Step 2', iconURL: client.user.displayAvatarURL() }).setDescription(`Please select your **${userState.type === 'Sell' ? 'Crypto Network' : 'Payment Method'}** from the dropdown below.`).addFields({ name: '🔄 Action', value: `${userState.type === 'Buy' ? '<:buy_sign:1521708980647231648> Buy USDT' : '<:sell_sign:1521709256947269803> Sell USDT'}`, inline: true }, { name: '💰 Amount', value: `$${userState.amount}`, inline: true });        
        await interaction.update({ content: '', embeds: [step2Embed], components: [new ActionRowBuilder().addComponents(typeDropdown), new ActionRowBuilder().addComponents(step2Dropdown)] });
    }

    if (interaction.isButton() && interaction.customId === 'proceed_to_details') {
        const userState = userSelections.get(interaction.user.id);
        const p2pModal = new ModalBuilder().setCustomId('final_p2p_modal').setTitle(`🏦 Details: ${userState.type} USDT`);
        
        if (userState.type === 'Sell') {
            if (userState.step3 === 'IMPS/UPI') {
                p2pModal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('bank_name').setLabel('Bank Name').setStyle(TextInputStyle.Short).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('account_name').setLabel('Account Holder Name').setStyle(TextInputStyle.Short).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('account_number').setLabel('Account Number').setStyle(TextInputStyle.Short).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ifsc_code').setLabel('IFSC Code').setStyle(TextInputStyle.Short).setRequired(true)));
            } else if (userState.step3 === 'CDM') {
                p2pModal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('cdm_bank_name').setLabel('Bank Name (e.g. SBI, ICICI)').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('cdm_account_name').setLabel('Account Holder Name').setStyle(TextInputStyle.Short).setRequired(true)), 
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('cdm_account_number').setLabel('Account Number').setStyle(TextInputStyle.Short).setRequired(true)), 
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('cdm_mobile_number').setLabel('Mobile Number').setStyle(TextInputStyle.Short).setRequired(true))
                );            
            } else if (userState.step3 === 'CCW') {
                p2pModal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ccw_ref_number').setLabel('Phone Number').setStyle(TextInputStyle.Short).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ccw_account_name').setLabel('Account Holder Name').setStyle(TextInputStyle.Short).setRequired(true)));
            }
        } else {
            p2pModal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('user_receiving_details').setLabel(`Your ${userState.step3} Wallet Address`).setStyle(TextInputStyle.Short).setRequired(true)));
        }
        await interaction.showModal(p2pModal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'final_p2p_modal') {
        const userState = userSelections.get(interaction.user.id);
        const tradeAmount = userState.amount; 
        let userDetails = "";

        if (userState.type === 'Sell') {
            if (userState.step3 === 'IMPS/UPI') userDetails = `Bank Name: ${interaction.fields.getTextInputValue('bank_name')}\nHolder Name: ${interaction.fields.getTextInputValue('account_name')}\nAccount No: ${interaction.fields.getTextInputValue('account_number')}\nIFSC Code: ${interaction.fields.getTextInputValue('ifsc_code')}`;
            else if (userState.step3 === 'CDM') userDetails = `Bank Name: ${interaction.fields.getTextInputValue('cdm_bank_name')}\nHolder Name: ${interaction.fields.getTextInputValue('cdm_account_name')}\nAccount No: ${interaction.fields.getTextInputValue('cdm_account_number')}\nMobile No: ${interaction.fields.getTextInputValue('cdm_mobile_number')}`;
            else if (userState.step3 === 'CCW') userDetails = `Phone No: ${interaction.fields.getTextInputValue('ccw_ref_number')}\nHolder Name: ${interaction.fields.getTextInputValue('ccw_account_name')}`;
        } else {
            userDetails = interaction.fields.getTextInputValue('user_receiving_details');
        }

        await interaction.update({ content: '🏦 Creating your secure P2P room...', embeds: [], components: [] });

        // ==========================================
        // 🔥 SMART ROUTING: Dynamic Categories based on Payment Method
        // ==========================================
        let categoryName = '🎫 TICKETS';
        
        if (userState.type === 'Buy') {
            if (userState.step2 === 'CDM') categoryName = '🟢 CDM FOR BUY';
            else categoryName = '🟢 CCW FOR BUY'; // Agar CCW hai
        } else if (userState.type === 'Sell') {
            if (userState.step3 === 'CDM') categoryName = '🔴 CDM FOR SELL';
            else categoryName = '🔴 IMPS-UPI FOR SELL'; // Agar IMPS, CCW, UPI hai
        }
        
        let targetCategory = interaction.guild.channels.cache.find(c => c.name === categoryName && c.type === ChannelType.GuildCategory);
        
        if (!targetCategory) {
            targetCategory = await interaction.guild.channels.create({ name: categoryName, type: ChannelType.GuildCategory });
        }

        const palermoRole = interaction.guild.roles.cache.find(role => role.name === 'Palermo');
        const verifiedRole = interaction.guild.roles.cache.find(role => role.name === 'Vault Verified');
        
        const channelPermissions = [{ id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }, { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }];
        if (verifiedRole) channelPermissions.push({ id: verifiedRole.id, deny: [PermissionsBitField.Flags.ViewChannel] });
        if (palermoRole) channelPermissions.push({ id: palermoRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageMessages] });

        const randomId = Math.random().toString(36).substring(2, 8);
        const ticketChannel = await interaction.guild.channels.create({ 
            name: `ticket-${randomId}`, 
            type: ChannelType.GuildText, 
            parent: targetCategory.id,
            permissionOverwrites: channelPermissions 
        });
        
        let walletData = {};
        let liveBuyPrice = 88;
        let liveSellPrice = 88;

        try {
            const setDoc = await db.collection('settings').doc('app_data').get();
            if (setDoc.exists) {
                const data = setDoc.data();
                if (data.wallets) walletData = data.wallets;
                if (data.liveBuyPrice) liveBuyPrice = Number(data.liveBuyPrice);
                if (data.liveSellPrice) liveSellPrice = Number(data.liveSellPrice);
            }
        } catch (e) { console.log('Error fetching app_data'); }

        if(!walletData['TRC20']) {
            walletData = {
                'TRC20': { address: 'TY2nj2zbk7EJ86ksKU2iyf1ns3c5YDZWn8', qrImage: 'https://media.discordapp.net/attachments/1515980898196000831/1518609546065612810/new_trc20.jpeg?ex=6a3a8ada&is=6a39395a&hm=84a4e15aaa779c3a9f929db2d0da9a9a92de6af9d50371e4efcccd5d6442c938&=&format=webp&width=550&height=880' },
                'ERC20': { address: '0xB4FFcD4367d8C9e673107F3DBE0aCd8bc75EBD49', qrImage: 'https://media.discordapp.net/attachments/1515980898196000831/1515981806372126780/erc20.jpeg?ex=6a30fb94&is=6a2faa14&hm=c15075479260ba5eb9dd34e447bd62c645ae52b8d692428c70c53a6ab32f56b7&=&format=webp&width=668&height=880' },
                'BEP20': { address: '0xB4FFcD4367d8C9e673107F3DBE0aCd8bc75EBD49', qrImage: 'https://media.discordapp.net/attachments/1515980898196000831/1515981287825870968/bep20.jpeg?ex=6a30fb18&is=6a2fa998&hm=e7b578ba45fd57461f8b136f8c5f16e018fa8037e297c64c9c3a2d69bdac6c8f&=&format=webp&width=669&height=880' },
                'ARBITRUM': { address: '0xB4FFcD4367d8C9e673107F3DBE0aCd8bc75EBD49', qrImage: 'https://media.discordapp.net/attachments/1515980898196000831/1515984868318908457/arbitrum.jpeg?ex=6a30fe6e&is=6a2facee&hm=d1a171cd44b807dbdd00cb08c4561be0ebdf6c3d31ed4972c7e7c405c297de33&=&format=webp&width=664&height=879' },
                'POLYGON': { address: '0xB4FFcD4367d8C9e673107F3DBE0aCd8bc75EBD49', qrImage: 'https://media.discordapp.net/attachments/1515980898196000831/1515986220025516132/usdt_polygon.jpeg?ex=6a30ffb0&is=6a2fae30&hm=4730140f626a657a3a0950b9f46614c0c5208690d94b1c84dab5c65026518147&=&format=webp&width=678&height=880' },
                'USDC_ERC20': { address: '0xB4FFcD4367d8C9e673107F3DBE0aCd8bc75EBD49', qrImage: 'https://media.discordapp.net/attachments/1515980898196000831/1515985509044846603/usdc_erc20.jpeg?ex=6a30ff07&is=6a2fad87&hm=b00ebb1a931cc1f260a38e55436172a92fc723ad3eb613cb53b4f523013fba5b&=&format=webp&width=679&height=880' },
                'USDC_BEP20': { address: '0xB4FFcD4367d8C9e673107F3DBE0aCd8bc75EBD49', qrImage: 'https://media.discordapp.net/attachments/1515980898196000831/1515986679129968781/usdc_bep20.jpeg?ex=6a31001d&is=6a2fae9d&hm=7c287ec6bfbe44b422c9cade0954846396b9dcc7f8c4b4ec3ba15728833d85e0&=&format=webp&width=674&height=879' },
            };
        }

        let easyCopyText = ""; 
        let qrImageUrl = null;

        if (userState.type === 'Sell') {
            if (walletData[userState.step2] && !walletData[userState.step2].address.includes('YAHAN_APNA')) {
                easyCopyText = walletData[userState.step2].address;
            } else {
                let networkName = userState.step2.replace('_', ' '); 
                easyCopyText = `Ask Admin for ${networkName} Wallet Address`;
            }
            if (walletData[userState.step2] && !walletData[userState.step2].qrImage.includes('Aapka_') && !walletData[userState.step2].qrImage.includes('SAHI_IMAGE_LINK')) {
                qrImageUrl = walletData[userState.step2].qrImage;
            }
        } else {
            let paymentDetails = "Waiting for Admin to provide bank details.";
            if (userState.step2 === 'UPI[CCW]' || userState.step2 === 'CCW' || userState.step2 === 'CDM') paymentDetails = "Talk to Admin for Payment Details";
            easyCopyText = paymentDetails; 
        }

        // 🔥 PERFECT EXTRA FEE LOGIC & LABEL 🔥
        // Base Fee: KYC = $0, Non-KYC = $3
        let fee = userState.isVerifiedTrade ? 0 : 3;
        let feeLabel = userState.isVerifiedTrade ? "KYC Fee: $0" : "Non-KYC Fee: $3";
        
        // Agar action 'Buy' hai aur network 'TRC20' hai -> Extra $1.5 add kar do
        if (userState.type === 'Buy' && userState.step3 === 'TRC20') {
            fee += 1.5; 
            feeLabel += " + TRC20 Network Fee: $1.5"; // Text mein extra detail jod di
        }

        const finalStep3Display = userState.step3 === 'CCW' ? 'CCW (ICICI, SBI)' : userState.step3;
        const buyNetworkDisplay = userState.step3 || 'Unknown';

        const baseAmount = Number(tradeAmount);
        const totalUsdtForCalc = baseAmount + fee;
        let totalInr = 0;
        let rateUsed = 0;
        let paymentInstructions = "";

        if (userState.type === 'Sell') {
            rateUsed = liveSellPrice;
            totalInr = baseAmount * rateUsed;
            paymentInstructions = `**⚠️ Payment Instructions:**\nThis is the **${userState.step2}** wallet address you selected.\n\nPlease send exactly **$${totalUsdtForCalc} USDT** to this address and upload the payment screenshot here.`;
        } else {
            rateUsed = liveBuyPrice;
            totalInr = totalUsdtForCalc * rateUsed;
            paymentInstructions = `**⚠️ Payment Instructions:**\nPlease pay exactly **₹${totalInr}** (INR) to the admin's account.\n\n👇 **Admin Payment Details Sent Below**\n\nOnce paid, please upload the payment screenshot here.`;
        }

        try {
            await db.collection('p2p_tickets').doc(ticketChannel.id).set({ 
                discordUserId: interaction.user.id, 
                username: interaction.user.username, 
                tradeType: userState.type, 
                networkOrMethod: userState.type === 'Sell' ? `${userState.step2} / ${finalStep3Display}` : `${userState.step2} / ${buyNetworkDisplay}`, 
                amountUsd: baseAmount, 
                fee: fee, 
                totalInr: totalInr, 
                rateUsed: rateUsed, 
                isVerifiedTrade: userState.isVerifiedTrade, 
                userReceivingDetails: userDetails, 
                adminTransferDetails: easyCopyText, 
                status: 'Open', 
                createdAt: admin.firestore.FieldValue.serverTimestamp() 
            });
            globalLastUpdate = Date.now(); 
        } catch (error) { console.error("Firebase Error: ", error); }

const cinematicDescription = `Welcome ${interaction.user.toString()}! Thanks for contacting the support team of **Professor Network**.\n\nPlease follow the instructions below so we can complete your trade as quickly as possible.\n\n**1. What is the action?**\n> ${userState.type} USDT\n\n**2. Core Amount**\n> $${baseAmount}\n\n**3. Which Method?**\n> ${userState.type === 'Sell' ? userState.step2 + ' (Receive via ' + finalStep3Display + ')' : userState.step2 + ' (Receive via ' + buyNetworkDisplay + ')'}\n\n**📊 Exchange Rate & Fees:**\n> Live Rate: ₹${rateUsed}/USDT\n> ${feeLabel}\n\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n${userState.type === 'Sell' ? `**You Need To Send: $${totalUsdtForCalc} USDT**\n**You Will Receive: ₹${totalInr} INR**` : `**You Need To Pay: ₹${totalInr} INR**\n**You Will Receive: $${baseAmount} USDT**`}`;
        const ticketEmbed = new EmbedBuilder().setColor(userState.isVerifiedTrade ? '#2ecc71' : '#e67e22').setAuthor({ name: `🏦 Secure P2P Room (${userState.isVerifiedTrade ? 'Vault Verified' : 'Non-KYC'})`, iconURL: client.user.displayAvatarURL() }).setDescription(cinematicDescription).setFooter({ text: 'Share your payment screenshot here after successful transfer.', iconURL: client.user.displayAvatarURL() });
        const paymentEmbed = new EmbedBuilder().setColor('#5865F2').setDescription(paymentInstructions);
        const actionButtonRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('complete_p2p_ticket').setLabel('✅ Mark Complete (Admin)').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('cancel_p2p_ticket').setLabel('❌ Cancel Trade').setStyle(ButtonStyle.Danger));

        await ticketChannel.send({ content: palermoRole ? `🔔 <@&${palermoRole.id}> | Ping: ${interaction.user.toString()}` : `Ping: ${interaction.user.toString()}`, embeds: [ticketEmbed], components: [actionButtonRow] });
        await ticketChannel.send({ embeds: [paymentEmbed] });

        if (userState.type === 'Sell' && !easyCopyText.includes("Ask Admin") && !easyCopyText.includes("Waiting")) {
             await ticketChannel.send(`\`${easyCopyText}\``);
        } else {
             await ticketChannel.send(`${easyCopyText}`);
        }
        await ticketChannel.send('▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬');

        const revealButtonsRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('reveal_user_details').setLabel('👨‍💼 View User Details (Only For Admin)').setStyle(ButtonStyle.Secondary));
        await ticketChannel.send({ content: `🔒 **Admin Secure Access**\nAdmins can click below to securely view the user's receiving information.`, components: [revealButtonsRow] });
        
        if (userState.type === 'Sell' && qrImageUrl) {
            const qrEmbed = new EmbedBuilder()
                .setColor('#f1c40f')
                .setTitle(`📲 Scan to Pay (${userState.step2})`)
                .setImage(qrImageUrl);
            await ticketChannel.send({ embeds: [qrEmbed] });
        }

        if (userState.type === 'Sell') {
            await ticketChannel.send({ content: `<@1336703883711479896>` });
            
        }

        // ==========================================
        // 🏦 BANK DETAILS LOG SYSTEM (FOR SELL TICKETS)
        // ==========================================
        if (userState.type === 'Sell') {
            try {
                let bankDetailsChannel = interaction.guild.channels.cache.find(c => c.name === '🏦・bank-details' || c.name.includes('bank-details'));
                
                // Agar channel nahi hai toh naya bana dega (Sirf Admin/Palermo dekh payenge)
                if (!bankDetailsChannel) {
                    const palermoRoleBank = interaction.guild.roles.cache.find(r => r.name === 'Palermo');
                    let bankPerms = [
                        { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                        { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                    ];
                    if (palermoRoleBank) bankPerms.push({ id: palermoRoleBank.id, allow: [PermissionsBitField.Flags.ViewChannel] });

                    bankDetailsChannel = await interaction.guild.channels.create({
                        name: '🏦・bank-details',
                        type: ChannelType.GuildText,
                        permissionOverwrites: bankPerms
                    });
                }

                const bankLogEmbed = new EmbedBuilder()
                    .setColor('#f1c40f')
                    .setTitle('🏦 New Seller Bank Details')
                    .setDescription(`A new **Sell** ticket has been opened. User is waiting for INR payment.`)
                    .addFields(
                        { name: '🎫 Ticket', value: `<#${ticketChannel.id}>`, inline: true },
                        { name: '👤 User', value: `${interaction.user.username}`, inline: true },
                        { name: '💰 Total To Pay', value: `**₹${totalInr} INR**`, inline: true },
                        { name: '🏦 Bank Details', value: `\`\`\`yaml\n${userDetails}\n\`\`\``, inline: false }
                    )
                    .setFooter({ text: 'Professor Network - Vault System', iconURL: client.user.displayAvatarURL() })
                    .setTimestamp();

                await bankDetailsChannel.send({ embeds: [bankLogEmbed] });
            } catch (err) {
                console.error("Bank details log error:", err);
            }
        }
        // ==========================================

        await interaction.editReply({ content: `✅ Ticket created successfully! Click here to view: ${ticketChannel}` });
        userSelections.delete(interaction.user.id);

        setTimeout(() => { interaction.deleteReply().catch(() => {}); }, 10000);
    }

    if (interaction.isButton() && interaction.customId === 'reveal_admin_details') {
        await interaction.deferReply({ ephemeral: true }); 
        try {
            const ticketDoc = await db.collection('p2p_tickets').doc(interaction.channel.id).get();
            if (ticketDoc.exists && interaction.user.id === ticketDoc.data().discordUserId) {
                await interaction.editReply({ content: `👇 **Long-press the message below to copy Admin Transfer Details:**` });
                await interaction.followUp({ content: `${ticketDoc.data().adminTransferDetails}`, ephemeral: true });
            } else { await interaction.editReply({ content: '❌ **Access Denied.**' }); }
        } catch (err) { await interaction.editReply({ content: '❌ Error.' }); }
    }

    if (interaction.isButton() && interaction.customId === 'reveal_user_details') {
        await interaction.deferReply({ ephemeral: true }); 
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) && !interaction.member.roles.cache.some(role => role.name === 'Palermo')) return interaction.editReply({ content: '❌ **Access Denied.**' });
        try {
            const ticketDoc = await db.collection('p2p_tickets').doc(interaction.channel.id).get();
            if (ticketDoc.exists) {
                await interaction.editReply({ content: `${ticketDoc.data().userReceivingDetails}` });
            } else { await interaction.editReply({ content: '❌ Ticket data not found.' }); }
        } catch (err) { await interaction.editReply({ content: '❌ Error.' }); }
    }

    if (interaction.isButton() && (interaction.customId === 'complete_p2p_ticket' || interaction.customId === 'cancel_p2p_ticket')) {
        const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) || interaction.member.roles.cache.some(role => role.name === 'Palermo');
        try {
            const ticketDoc = await db.collection('p2p_tickets').doc(interaction.channel.id).get();
            if (!ticketDoc.exists) return interaction.reply({ content: '❌ Ticket data not found.', ephemeral: true });
            const ticketData = ticketDoc.data();
            
            if (interaction.customId === 'complete_p2p_ticket' && !isAdmin) return interaction.reply({ content: '❌ **Access Denied.**', ephemeral: true });
            if (interaction.customId === 'cancel_p2p_ticket' && !isAdmin && interaction.user.id !== ticketData.discordUserId) return interaction.reply({ content: '❌ **Access Denied.**', ephemeral: true });

            const isSuccess = interaction.customId === 'complete_p2p_ticket';
            const finalStatus = isSuccess ? 'Completed' : 'Cancelled';

            await interaction.reply({ content: `🔒 Ticket is being marked as **${finalStatus}** in 5 seconds...` });

            const member = await interaction.guild.members.fetch(ticketData.discordUserId).catch(() => null);
            if (member) {
                if (isSuccess) {
                    let feedRole = interaction.guild.roles.cache.find(r => r.name === 'transaction done');
                    if (feedRole) await member.roles.add(feedRole).catch(() => {});

                    const receiptEmbed = new EmbedBuilder()
                        .setColor('#2ecc71')
                        .setTitle('✅ Transaction Completed')
                        .setDescription(`Hello **${ticketData.username}**,\n\nYour P2P transaction of **$${ticketData.amountUsd}** has been successfully completed by the Professor Network team.\n\nThank you for trading with Professor Network. 🏦`)
                        .setFooter({ text: 'Professor Network • Secure Exchange Terminal' });

                    const receiptBtn = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setLabel('Return to Exchange Desk').setStyle(ButtonStyle.Link).setURL('https://discord.gg/2wvPqE5e4Z')
                    );
                    
                    await member.send({ embeds: [receiptEmbed], components: [receiptBtn] }).catch(()=>{});

                    const feedbackEmbed = new EmbedBuilder()
                        .setColor('#f1c40f')
                        .setTitle('⭐ Rate Your Experience')
                        .setDescription(`We hope you had a smooth trade!\n\nPlease click the button below to give your valuable feedback in <#1495117550709903591>.\nYour reviews help us build community trust. 🤝`)
                        .setFooter({ text: 'Professor Network • Reviews' });

                    const feedbackBtn = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setLabel('⭐ Give Feedback Here').setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${interaction.guild.id}/1495117550709903591`)
                    );

                    await member.send({ embeds: [feedbackEmbed], components: [feedbackBtn] }).catch(()=>{});
                } else {
                    const cancelEmbed = new EmbedBuilder()
                        .setColor('#e74c3c')
                        .setTitle('❌ Transaction Cancelled')
                        .setDescription(`Hello **${ticketData.username}**,\n\nYour P2P transaction of **$${ticketData.amountUsd}** has been cancelled by the Professor Network team.\n\nThis transaction was marked incomplete and has been closed from the exchange system.\n\nIf you believe this was done by mistake or need assistance, please contact <@1336703883711479896>.`)
                        .setFooter({ text: 'Professor Network • Secure Exchange Terminal' });

                    const cancelBtn = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setLabel('Return to Exchange Desk').setStyle(ButtonStyle.Link).setURL('https://discord.gg/2wvPqE5e4Z')
                    );

                    await member.send({ embeds: [cancelEmbed], components: [cancelBtn] }).catch(()=>{});
                }
            }

            let logChannel = interaction.guild.channels.cache.find(c => c.name === 'transaction-logs');
            if (!logChannel) {
                const palermoRoleForLog = interaction.guild.roles.cache.find(r => r.name === 'Palermo');
                const verifiedRoleForLog = interaction.guild.roles.cache.find(r => r.name === 'Verified');
                let logPerms = [{ id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }];
                if (verifiedRoleForLog) logPerms.push({ id: verifiedRoleForLog.id, deny: [PermissionsBitField.Flags.ViewChannel] });
                if (palermoRoleForLog) logPerms.push({ id: palermoRoleForLog.id, allow: [PermissionsBitField.Flags.ViewChannel] });
                logChannel = await interaction.guild.channels.create({ name: 'transaction-logs', type: ChannelType.GuildText, permissionOverwrites: logPerms });
            }

            const vaultEmbed = new EmbedBuilder().setColor(isSuccess ? '#f1c40f' : '#e74c3c').setTitle(`🏦 Vault Record: Transaction ${finalStatus}`).addFields({ name: '👤 User', value: String(ticketData.username || 'Unknown'), inline: true }, { name: '🔒 Handled By', value: String(interaction.user.username || 'Admin'), inline: true }, { name: 'Trade Type', value: String(ticketData.tradeType || 'Unknown'), inline: true }, { name: 'Amount', value: `$${ticketData.amountUsd || 0}`, inline: true }, { name: 'Method/Network', value: String(ticketData.networkOrMethod || 'Unknown'), inline: true }, { name: 'Status', value: `\`${finalStatus}\``, inline: true }).setTimestamp().setFooter({ text: `Ticket ID: ${interaction.channel.id}` });
            await logChannel.send({ embeds: [vaultEmbed] });
            
            if (isSuccess) {
                let publicLogChannel = interaction.guild.channels.cache.find(c => c.name === '✅・completed-transactions' || c.name.includes('completed-transactions'));
                if (!publicLogChannel) publicLogChannel = await interaction.guild.channels.create({ name: '✅・completed-transactions', type: ChannelType.GuildText, permissionOverwrites: [{ id: interaction.guild.id, deny: [PermissionsBitField.Flags.SendMessages], allow: [PermissionsBitField.Flags.ViewChannel] }, { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }] });
                
                await publicLogChannel.send({ 
                    embeds: [
                        new EmbedBuilder()
                            .setColor('#2ecc71')
                            .setTitle('✅ Secure Trade Completed')
                            .setDescription(`Another successful transaction has been processed through Professor Network. 🏦\n\n💱 Trade: ${ticketData.tradeType}\n💰 Volume: $${ticketData.amountUsd}\n\n⚠️ Users are responsible for their own tax compliance.`)
                            .setTimestamp()
                            .setFooter({ text: 'Professor Network • Trusted P2P Terminal', iconURL: client.user.displayAvatarURL() })
                    ] 
                });
            }

            await db.collection('p2p_tickets').doc(interaction.channel.id).update({ status: finalStatus, closedBy: interaction.user.username, closedAt: admin.firestore.FieldValue.serverTimestamp() });
            globalLastUpdate = Date.now(); 

            if (isSuccess) { updateWeeklyLeaderboard(interaction.guild); await updateUserHeistPoints(ticketData.discordUserId, interaction.guild, ticketData.username); }

            const mainTicketChannel = interaction.guild.channels.cache.get('1503666259244482642'); 
            if (mainTicketChannel) {
                const fetchedMessages = await mainTicketChannel.messages.fetch({ limit: 50 });
                fetchedMessages.filter(m => m.author.id === client.user.id).forEach(msg => msg.delete().catch(console.error));
                await mainTicketChannel.send({ embeds: [new EmbedBuilder().setColor('#2b2d31').setTitle('🏦 Exchange Desk (P2P)').setDescription('Welcome to the Professor Network.\n\nClick the button below to start trading securely.').setFooter({ text: 'Automated by Professor Network' })], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('start_p2p_trade').setLabel('🚀 Start Trade').setStyle(ButtonStyle.Primary))] });
            }
            
            // ==========================================
            // 🗑️ AUTO-DELETE BANK DETAILS LOG ON CLOSE
            // ==========================================
            try {
                const bankDetailsChannel = interaction.guild.channels.cache.find(c => c.name === '🏦・bank-details' || c.name.includes('bank-details'));
                if (bankDetailsChannel) {
                    const fetchedLogs = await bankDetailsChannel.messages.fetch({ limit: 100 });
                    // Us message ko dhoondo jisme is ticket ka ID hai
                    const logToDelete = fetchedLogs.find(m => 
                        m.embeds.length > 0 && 
                        m.embeds[0].fields && 
                        m.embeds[0].fields.some(f => f.name === '🎫 Ticket' && f.value.includes(interaction.channel.id))
                    );
                    
                    if (logToDelete) {
                        await logToDelete.delete();
                    }
                }
            } catch (err) { console.error("Bank detail log delete error:", err); }
            // ==========================================  

            setTimeout(() => { interaction.channel.delete().catch(console.error); }, 5000);
        } catch (error) { console.error("Error Closing Ticket: ", error); }
    }
});

async function updateWeeklyLeaderboard(guild) {
    if (!guild) return;
    try {
        const channel = guild.channels.cache.get('1506661433335746560') || guild.channels.cache.find(c => c.name === '📈・weekly-recap' || c.name.includes('weekly-recap'));
        if (!channel) return; 

        const snapshot = await db.collection('p2p_tickets').where('status', '==', 'Completed').get();
        const now = new Date();
        const userVolumes = {};
        
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.closedAt && typeof data.closedAt.toDate === 'function') {
                if (Math.abs(now - data.closedAt.toDate()) / (1000 * 60 * 60 * 24) <= 7) { 
                    const tag = (data.discordUserId && data.username) ? `[**@${data.username}**](https://discord.com/users/${data.discordUserId})` : (data.discordUserId ? `<@${data.discordUserId}>` : data.username);
                    userVolumes[tag] = (userVolumes[tag] || 0) + (data.amountUsd || 0);
                }
            }
        });
        const top10 = Object.keys(userVolumes).map(tag => ({ tag, volume: userVolumes[tag] })).sort((a, b) => b.volume - a.volume).slice(0, 10);
        let description = 'These are the Top 10 Highest Volume P2P Traders of the last 7 days:\n\n';
        if (top10.length === 0) description += '*No completed trades found for this week yet.*';
        else top10.forEach((trader, index) => { description += `${['🥇', '🥈', '🥉', '🏅', '🏅', '🎖️', '🎖️', '🎖️', '🎖️', '🎖️'][index]} **${index + 1}.** ${trader.tag}\n`; });
        const embed = new EmbedBuilder().setColor('#f1c40f').setTitle('🏆 Live Weekly Top Traders').setDescription(description).setTimestamp().setFooter({ text: 'Updates Automatically | Professor Network', iconURL: client.user.displayAvatarURL() });
        const messages = await channel.messages.fetch({ limit: 10 });
        const botMsg = messages.find(m => m.author.id === client.user.id);
        if (botMsg) await botMsg.edit({ embeds: [embed], components: [] }); else await channel.send({ embeds: [embed] });
    } catch (error) {}
}

async function updateUserHeistPoints(userId, guild, username) {
    try {
        const snapshot = await db.collection('p2p_tickets').where('discordUserId', '==', userId).where('status', '==', 'Completed').get();
        let totalVolume = 0;
        snapshot.forEach(doc => totalVolume += (doc.data().amountUsd || 0));
        const points = Math.floor(totalVolume / 10);
        const LEVELS = [{ name: '👑 Level 5 — Syndicate', minPoints: 5000 }, { name: '💎 Level 4 — Elite', minPoints: 1500 }, { name: '🥇 Level 3 — Insider', minPoints: 500 }, { name: '🥈 Level 2 — Operator', minPoints: 100 }, { name: '🥉 Level 1 — Recruit', minPoints: 0 }];
        let targetLevel = LEVELS.find(l => points >= l.minPoints) || LEVELS[4];

        await db.collection('user_stats').doc(userId).set({ discordId: userId, username: username, totalVolume: totalVolume, heistPoints: points, level: targetLevel.name, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

        const member = await guild.members.fetch(userId).catch(()=>null);
        if (member) {
            for (const lvl of LEVELS) {
                let role = guild.roles.cache.find(r => r.name === lvl.name);
                if (!role) role = await guild.roles.create({ name: lvl.name, color: '#e74c3c' });
                if (lvl.name === targetLevel.name) {
                    if (!member.roles.cache.has(role.id)) {
                        await member.roles.add(role);
                        let levelChannel = guild.channels.cache.find(c => c.name === '🎀・level-updates' || c.name.includes('level-updates'));
                        if (!levelChannel) levelChannel = await guild.channels.create({ name: '🎀・level-updates', type: ChannelType.GuildText, permissionOverwrites: [{ id: guild.id, deny: [PermissionsBitField.Flags.SendMessages], allow: [PermissionsBitField.Flags.ViewChannel] }, { id: client.user.id, allow: [PermissionsBitField.Flags.SendMessages] }] });
                        await levelChannel.send({ content: `🔔 **Level Up Alert!** | <@${userId}>`, embeds: [new EmbedBuilder().setColor('#e74c3c').setTitle('💰 NEW RANK UNLOCKED!').setDescription(`Congratulations <@${userId}>! You've successfully reached **${targetLevel.name}** with **${points} Heist Points**.\n\nEnjoy your new perks and keep trading to reach the top!`).setFooter({ text: 'Professor Network - Auto Rank System', iconURL: client.user.displayAvatarURL() })] });
                    }
                } else { if (member.roles.cache.has(role.id)) await member.roles.remove(role); }
            }
        }
        updateHeistLeaderboard(guild);
    } catch(e) {}
}

async function updateHeistLeaderboard(guild) {
    if (!guild) return;
    try {
        const channel = guild.channels.cache.find(c => c.name === '✨・heist-points' || c.name.includes('heist-leaderboard'));
        if (!channel) return;
        const snapshot = await db.collection('user_stats').orderBy('heistPoints', 'desc').limit(10).get();
        let desc = 'These are the Top 10 Syndicate Members ranked by total Heist Points:\n\n';
        if (snapshot.empty) desc += '*No stats recorded yet.*';
        let i = 1;
        snapshot.forEach(doc => {
            const data = doc.data();
            desc += `${['🥇', '🥈', '🥉', '🏅', '🏅', '🎖️', '🎖️', '🎖️', '🎖️', '🎖️'][i-1] || '🎖️'} **${i}.** ${data.username ? `[**@${data.username}**](https://discord.com/users/${data.discordId})` : `<@${data.discordId}>`} — **${data.heistPoints} Pts** | Rank: ${data.level ? data.level.split('—')[1].trim() : 'Recruit'}\n`;
            i++;
        });
        const embed = new EmbedBuilder().setColor('#e74c3c').setTitle('💰 THE VAULT | HEIST POINTS LEADERBOARD').setDescription(desc).setTimestamp().setFooter({ text: 'Updates Automatically | Professor Network', iconURL: client.user.displayAvatarURL() });
        const messages = await channel.messages.fetch({ limit: 10 });
        const botMsg = messages.find(m => m.author.id === client.user.id);
        if (botMsg) await botMsg.edit({ embeds: [embed] }); else await channel.send({ embeds: [embed] });
    } catch (e) {}
}

async function approveUserKYC(userId, guild) {
    let verifiedRole = guild.roles.cache.find(r => r.name === 'Vault Verified');
    if (!verifiedRole) verifiedRole = await guild.roles.create({ name: 'Vault Verified', color: '#2ecc71' });
    try {
        const member = await guild.members.fetch(userId);
        await member.roles.add(verifiedRole);
        await db.collection('users_kyc').doc(userId).set({ 
            discordId: userId,
            username: member.user.username,
            status: 'Approved',
            kycType: 'Advanced (Vault Verified)',
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true }).catch(()=>{});
        
        globalLastUpdate = Date.now();
        await member.send({ embeds: [new EmbedBuilder().setColor('#2ecc71').setTitle('🏦 Professor Network').setDescription('Your KYC verification has been successfully approved.\n\nYou have now received the **🏦 Vault Verified** role, unlocking:\n• $0 transaction fee  \n• Faster processing  \n• Higher trust status inside the network   \n**Please Visit <#1503666259244482642> To Start Trading **  \n\nWelcome to the verified side of the network. ⚡')] }).catch(() => {});
    } catch (e) {}
}

// ==========================================
// 🌐 WEB DASHBOARD (EXPRESS SERVER)
// ==========================================
const app = express();
// ==========================================
// 🛡️ SECURITY: RATE LIMITING (BRUTE-FORCE PROTECTION)
// ==========================================
const loginLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, 
    max: 5, 
    message: 'Too many login attempts from this IP, please try again after 5 minutes.'
});
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
// 🔥 SECURE CORS CONFIGURATION
const corsOptions = {
    origin: [
        'http://localhost:3000', 
        'http://localhost:4000',
        'http://147.93.103.102:3000', 
        'http://147.93.103.102:4000'  
    ],
    methods: ['GET', 'POST'],
    credentials: true 
};
app.use(cors(corsOptions));
// 🔥 SECURE SESSION FOR MAIN DASHBOARD
app.use(session({ 
    secret: process.env.SESSION_SECRET_MAIN || 'fallback-secret-key-1', 
    resave: false, 
    saveUninitialized: false, 
    cookie: { 
        secure: process.env.NODE_ENV === 'production', 
        httpOnly: true, 
        sameSite: 'strict', 
        maxAge: 7 * 24 * 60 * 60 * 1000 
    } 
}));

const requireLogin = (req, res, next) => { if (req.session.loggedIn) return next(); res.redirect('/login'); };

app.get('/login', (req, res) => { if (req.session.loggedIn) return res.redirect('/'); res.render('login', { error: null }); });

app.post('/login', loginLimiter, async (req, res) => {
    const { username, password } = req.body;
    try {
        const authDoc = await db.collection('settings').doc('admin_auth').get();
        let validUser = 'professor';
        let validPassHash = '';

        if (authDoc.exists) { 
            validUser = authDoc.data().username; 
            validPassHash = authDoc.data().password; 
            if (!validPassHash.startsWith('$2b$')) {
                if (username === validUser && password === validPassHash) {
                    const newHash = await bcrypt.hash(password, 10);
                    await db.collection('settings').doc('admin_auth').update({ password: newHash });
                    req.session.loggedIn = true; 
                    return res.redirect('/');
                }
            }
        } else { 
            validPassHash = await bcrypt.hash('heist2026', 10);
            await db.collection('settings').doc('admin_auth').set({ username: validUser, password: validPassHash }); 
        }

        if (username === validUser) {
            const isMatch = await bcrypt.compare(password, validPassHash);
            if (isMatch) {
                req.session.loggedIn = true; 
                return res.redirect('/');
            }
        }
        res.render('login', { error: 'Access Denied. Incorrect Credentials.' });
    } catch (error) { res.render('login', { error: 'Database Connection Error. Please verify network.' }); }
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

app.post('/update-credentials', requireLogin, async (req, res) => {
    const { new_username, new_password } = req.body;
    if (new_username && new_password) {
        const hashedPass = await bcrypt.hash(new_password, 10);
        await db.collection('settings').doc('admin_auth').set({ username: new_username, password: hashedPass });
        req.session.destroy();
        res.redirect('/login');
    } else { res.redirect('/'); }
});

app.get('/export-ledger', requireLogin, async (req, res) => {
    try {
        const snapshot = await db.collection('p2p_tickets').where('status', '==', 'Completed').get();
        const workbook = new excelJS.Workbook();
        workbook.creator = 'Professor Network';
        const worksheet = workbook.addWorksheet('Vault Ledger');

        worksheet.columns = [
            { header: 'DATE', key: 'date', width: 25 },
            { header: 'TRADE', key: 'trade', width: 12 },
            { header: 'DISCORD NAME', key: 'name', width: 25 },
            { header: 'AMOUNT $', key: 'amount', width: 15 },
            { header: 'METHOD', key: 'method', width: 20 },
            { header: 'TRANSACTION DETAILS', key: 'details', width: 50 },
            { header: 'KYC STATUS', key: 'kyc', width: 18 }
        ];

        worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2B2D31' } }; 
        worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

        snapshot.forEach(docSnap => {
            const d = docSnap.data();
            const dateStr = (d.closedAt && typeof d.closedAt.toDate === 'function') ? d.closedAt.toDate().toLocaleString('en-IN') : 'N/A';
            const tradeType = d.tradeType || 'N/A';
            const discordName = d.username || 'N/A';
            const amountStr = `$${d.amountUsd || 0}`;
            const methodStr = d.networkOrMethod || 'N/A';
            
            let detailsStr = d.userReceivingDetails || d.adminTransferDetails || 'N/A';
            detailsStr = detailsStr.replace(/\n/g, ' | '); 

            const kycStatus = d.isVerifiedTrade ? 'Verified' : 'Non Verified';

            const row = worksheet.addRow({ date: dateStr, trade: tradeType, name: discordName, amount: amountStr, method: methodStr, details: detailsStr, kyc: kycStatus });
            row.alignment = { vertical: 'middle' };
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="The_Vault_Ledger_Report.xlsx"');

        await workbook.xlsx.write(res);
        res.end();
    } catch(e) { res.send("Export Error: " + e.message); }
});

const GUILD_ID = '1450915791338737757';

app.post('/api/kyc-approve', requireLogin, async (req, res) => {
    const { userId } = req.body;
    try {
        const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
        if (!guild) return res.json({ success: false, error: "Discord server connection lost." });
        await approveUserKYC(userId, guild);
        res.json({ success: true });
    } catch (e) { res.json({ success: false, error: e.message }); }
});

app.post('/api/kyc-reject', requireLogin, async (req, res) => {
    const { userId } = req.body;
    try {
        await db.collection('users_kyc').doc(userId).update({ status: 'Rejected' });
        globalLastUpdate = Date.now(); 
        res.json({ success: true });
    } catch (e) { res.json({ success: false, error: e.message }); }
});

app.post('/api/kyc-delete', requireLogin, async (req, res) => {
    const { userId } = req.body;
    try {
        try {
            const [files] = await bucket.getFiles({ prefix: `kyc_documents/${userId}_` });
            await Promise.all(files.map(file => file.delete()));
        } catch (storageErr) {}

        try {
            const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
            if (guild) {
                const member = await guild.members.fetch(userId).catch(() => null);
                if (member) {
                    const verifiedRole = guild.roles.cache.find(r => r.name === 'Vault Verified');
                    if (verifiedRole && member.roles.cache.has(verifiedRole.id)) {
                        await member.roles.remove(verifiedRole);
                        const revokeEmbed = new EmbedBuilder().setColor('#e74c3c').setTitle('⚠️ KYC Status Revoked').setDescription('Your **Vault Verified** status has been removed and your KYC data has been deleted from the Professor Network database by an Admin.').setFooter({ text: 'Professor Network Security' });
                        await member.send({ embeds: [revokeEmbed] }).catch(() => {});
                    }
                }
            }
        } catch (discordErr) {}

        await db.collection('users_kyc').doc(userId).delete();
        globalLastUpdate = Date.now(); 
        res.json({ success: true });
    } catch (e) { res.json({ success: false, error: e.message }); }
});

app.post('/update-price', requireLogin, async (req, res) => {
    const { buyPrice, sellPrice } = req.body; 
    const sendModernAlert = (title, text, icon) => {
        res.send(`
            <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
            <style>body { background-color: #0b1120; color: #fff; font-family: sans-serif; }</style>
            <body><script>Swal.fire({title: '${title}', text: '${text}', icon: '${icon}', background: '#0f172a', color: '#f8fafc', confirmButtonColor: '${icon === 'error' ? '#ef4444' : '#22c55e'}', confirmButtonText: 'OK'}).then(() => { window.location.href = "/"; });</script></body>
        `);
    };

    try {
        // 🔥 NAYA: Database mein Live Prices Save karein 🔥
        await db.collection('settings').doc('app_data').set({ 
            liveBuyPrice: Number(buyPrice), 
            liveSellPrice: Number(sellPrice) 
        }, { merge: true });

        const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
        if (!guild) return sendModernAlert("❌ Error", "Discord server not found.", "error");
        let priceChannel = guild.channels.cache.get('1503666351594799205'); 
        if (!priceChannel) return sendModernAlert("❌ Error", "Price Update Channel not found.", "error");

        const priceEmbed = new EmbedBuilder().setColor('#f1c40f').setTitle('📈 USDT Market Price Update').setDescription('**Professor Network** has updated the real-time P2P exchange rates.').addFields({ name: '🟢 BUY PRICE', value: `\`\`\`yaml\n₹ ${buyPrice}\n\`\`\``, inline: true }, { name: '🔴 SELL PRICE', value: `\`\`\`yaml\n₹ ${sellPrice}\n\`\`\``, inline: true }).setTimestamp().setFooter({ text: 'Professor Network - Market Sync', iconURL: client.user.displayAvatarURL() });

        await priceChannel.send({ content: '@everyone', embeds: [priceEmbed] });       
        sendModernAlert("✅ Success!", "Market Price Broadcasted Successfully to Discord!", "success");
    } catch (error) { sendModernAlert("❌ Error", error.message, "error"); }
});

app.get('/api/check-updates', requireLogin, (req, res) => { res.json({ timestamp: globalLastUpdate }); });

app.get('/', requireLogin, async (req, res) => {
    try {
        const guild = client.guilds.cache.get(GUILD_ID); 
        const liveMembers = guild ? guild.memberCount : 0;
        const snapshot = await db.collection('p2p_tickets').where('status', '==', 'Completed').get();
        const pendingTicketsSnap = await db.collection('p2p_tickets').where('status', '==', 'Open').get();
        
        const allKycSnap = await db.collection('users_kyc').get();
        const allKycUsers = [];
        const upiKycUsers = []; 
        allKycSnap.forEach(doc => {
            const data = doc.data();
            if (data.kycType === 'Advanced (Vault Verified)') allKycUsers.push({ id: doc.id, ...data });
            if (data.upiVerified === true) upiKycUsers.push({ id: doc.id, ...data }); 
        });

        const pendingKycSnap = await db.collection('users_kyc').where('status', '==', 'Pending').get();
        const pendingKycList = [];
        pendingKycSnap.forEach(doc => { pendingKycList.push(doc.data()); });

        let dailyVol = 0, weeklyVol = 0, monthlyVol = 0, buyVol = 0, sellVol = 0;
        const now = new Date();
        const userVolumes = {}; 
        const allCompleted = [];
        const monthWiseData = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; 
        const calendarData = {}; 

        snapshot.forEach(doc => {
            const data = doc.data();
            const amount = data.amountUsd || 0;
            allCompleted.push(data);
            if (data.tradeType === 'Buy') buyVol += amount;
            if (data.tradeType === 'Sell') sellVol += amount;

            const username = data.username || 'Unknown';
            if (userVolumes[username]) userVolumes[username] += amount; else userVolumes[username] = amount;

            if (data.closedAt && typeof data.closedAt.toDate === 'function') {
                const tradeDate = data.closedAt.toDate();
                monthWiseData[tradeDate.getMonth()] += amount;
                
                const dateKey = `${tradeDate.getFullYear()}-${String(tradeDate.getMonth() + 1).padStart(2, '0')}-${String(tradeDate.getDate()).padStart(2, '0')}`;
                calendarData[dateKey] = (calendarData[dateKey] || 0) + amount;

                const diffDays = Math.ceil(Math.abs(now - tradeDate) / (1000 * 60 * 60 * 24)); 
                if (diffDays <= 1) dailyVol += amount;
                if (diffDays <= 7) weeklyVol += amount;
                if (diffDays <= 30) monthlyVol += amount;
            }
        });

        allCompleted.sort((a, b) => {
            const dateA = (a.closedAt && typeof a.closedAt.toDate === 'function') ? a.closedAt.toDate() : new Date(0);
            const dateB = (b.closedAt && typeof b.closedAt.toDate === 'function') ? b.closedAt.toDate() : new Date(0);
            return dateB - dateA;
        });
        
        const topTraders = Object.keys(userVolumes).map(username => ({ username, totalVolume: userVolumes[username] })).sort((a, b) => b.totalVolume - a.totalVolume).slice(0, 5);

        res.render('dashboard', { 
            liveMembers, dailyVol, weeklyVol, monthlyVol, topTraders, pendingTickets: pendingTicketsSnap.size, pendingKyc: pendingKycSnap.size,
            pendingKycList, buyVol, sellVol, recentFeed: allCompleted.slice(0, 10), allLogs: allCompleted, monthWiseData: JSON.stringify(monthWiseData), calendarData: JSON.stringify(calendarData), allKycUsers, upiKycUsers
        }); 
    } catch (error) { res.send("Dashboard Error: " + error.message); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`📊 Admin Vault Dashboard is LIVE on Port ${PORT}`); });

// ==========================================
// 🛡️ SEPARATE ADMINISTRATOR DASHBOARD (PORT 4000)
// ==========================================
const adminApp = express();
adminApp.set('view engine', 'ejs');
adminApp.use(express.urlencoded({ extended: true }));
adminApp.use(express.json());
adminApp.use(cors(corsOptions));
// 🔥 SECURE SESSION FOR MASTER ADMIN
adminApp.use(session({ 
    secret: process.env.SESSION_SECRET_ADMIN || 'fallback-secret-key-2', 
    resave: false, 
    saveUninitialized: false, 
    cookie: { 
        secure: process.env.NODE_ENV === 'production', 
        httpOnly: true, 
        sameSite: 'strict', 
        maxAge: 7 * 24 * 60 * 60 * 1000 
    } 
}));

const requireAdminLogin = (req, res, next) => { if (req.session.loggedIn) return next(); res.redirect('/login'); };

adminApp.get('/login', (req, res) => { if (req.session.loggedIn) return res.redirect('/'); res.render('login', { error: null }); });

adminApp.post('/login', loginLimiter, async (req, res) => {
    const { username, password } = req.body;
    try {
        const authDoc = await db.collection('settings').doc('admin_auth').get();
        if (!authDoc.exists) return res.render('login', { error: 'Admin setup incomplete. Login to Main Dashboard first.' });
        
        const validUser = authDoc.data().username;
        const validPassHash = authDoc.data().password;

        if (username === validUser) {
            const isMatch = await bcrypt.compare(password, validPassHash);
            if (isMatch) {
                req.session.loggedIn = true; 
                return res.redirect('/');
            }
        }
        res.render('login', { error: 'Access Denied. Incorrect Credentials.' });
    } catch (error) { res.render('login', { error: 'Database Connection Error.' }); }
});

adminApp.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

adminApp.get('/', requireAdminLogin, async (req, res) => {
    let appSettings = { 
        wallets: {
            'TRC20': { address: 'TY2nj2zbk7EJ86ksKU2iyf1ns3c5YDZWn8', qrImage: 'https://media.discordapp.net/attachments/1515980898196000831/1518609546065612810/new_trc20.jpeg?ex=6a3a8ada&is=6a39395a&hm=84a4e15aaa779c3a9f929db2d0da9a9a92de6af9d50371e4efcccd5d6442c938&=&format=webp&width=550&height=880' },
            'ERC20': { address: '0xB4FFcD4367d8C9e673107F3DBE0aCd8bc75EBD49', qrImage: 'https://media.discordapp.net/attachments/1515980898196000831/1515981806372126780/erc20.jpeg?ex=6a30fb94&is=6a2faa14&hm=c15075479260ba5eb9dd34e447bd62c645ae52b8d692428c70c53a6ab32f56b7&=&format=webp&width=668&height=880' },
            'BEP20': { address: '0xB4FFcD4367d8C9e673107F3DBE0aCd8bc75EBD49', qrImage: 'https://media.discordapp.net/attachments/1515980898196000831/1515981287825870968/bep20.jpeg?ex=6a30fb18&is=6a2fa998&hm=e7b578ba45fd57461f8b136f8c5f16e018fa8037e297c64c9c3a2d69bdac6c8f&=&format=webp&width=669&height=880' },
            'ARBITRUM': { address: '0xB4FFcD4367d8C9e673107F3DBE0aCd8bc75EBD49', qrImage: 'https://media.discordapp.net/attachments/1515980898196000831/1515984868318908457/arbitrum.jpeg?ex=6a30fe6e&is=6a2facee&hm=d1a171cd44b807dbdd00cb08c4561be0ebdf6c3d31ed4972c7e7c405c297de33&=&format=webp&width=664&height=879' },
            'POLYGON': { address: '0xB4FFcD4367d8C9e673107F3DBE0aCd8bc75EBD49', qrImage: 'https://media.discordapp.net/attachments/1515980898196000831/1515986220025516132/usdt_polygon.jpeg?ex=6a30ffb0&is=6a2fae30&hm=4730140f626a657a3a0950b9f46614c0c5208690d94b1c84dab5c65026518147&=&format=webp&width=678&height=880' },
            'USDC_ERC20': { address: '0xB4FFcD4367d8C9e673107F3DBE0aCd8bc75EBD49', qrImage: 'https://media.discordapp.net/attachments/1515980898196000831/1515985509044846603/usdc_erc20.jpeg?ex=6a30ff07&is=6a2fad87&hm=b00ebb1a931cc1f260a38e55436172a92fc723ad3eb613cb53b4f523013fba5b&=&format=webp&width=679&height=880' },
            'USDC_BEP20': { address: '0xB4FFcD4367d8C9e673107F3DBE0aCd8bc75EBD49', qrImage: 'https://media.discordapp.net/attachments/1515980898196000831/1515986679129968781/usdc_bep20.jpeg?ex=6a31001d&is=6a2fae9d&hm=7c287ec6bfbe44b422c9cade0954846396b9dcc7f8c4b4ec3ba15728833d85e0&=&format=webp&width=674&height=879' }
        }, 
        estTimes: { 'imps/UPI': '2 Hour', 'cdm': '45 Minutes to 1 Hour' } 
    };

    try {
        const settingsDoc = await db.collection('settings').doc('app_data').get();
        if (settingsDoc.exists) {
            const savedData = settingsDoc.data();
            if (savedData.wallets) appSettings.wallets = { ...appSettings.wallets, ...savedData.wallets };
            if (savedData.estTimes) appSettings.estTimes = { ...appSettings.estTimes, ...savedData.estTimes };
        }
    } catch (e) { console.error("Error loading settings", e); }
    
    res.render('administrator', { appSettings });
});

adminApp.post('/update-app-settings', requireAdminLogin, async (req, res) => {
    try {
        const newData = {
            wallets: {
                'TRC20': { address: req.body.trc20_address, qrImage: req.body.trc20_qr },
                'ERC20': { address: req.body.erc20_address, qrImage: req.body.erc20_qr },
                'BEP20': { address: req.body.bep20_address, qrImage: req.body.bep20_qr },
                'ARBITRUM': { address: req.body.arbitrum_address, qrImage: req.body.arbitrum_qr },
                'POLYGON': { address: req.body.polygon_address, qrImage: req.body.polygon_qr },
                'USDC_ERC20': { address: req.body.usdc_erc20_address, qrImage: req.body.usdc_erc20_qr },
                'USDC_BEP20': { address: req.body.usdc_bep20_address, qrImage: req.body.usdc_bep20_qr }
            },
            estTimes: {
                'imps/UPI': req.body.imps_time || '2 Hour',
                'cdm': req.body.cdm_time || '45 Minutes to 1 Hour'
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        await db.collection('settings').doc('app_data').set(newData, { merge: true });
        
        res.send(`
            <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
            <style>body { background-color: #0b1120; color: #fff; font-family: sans-serif; }</style>
            <body><script>Swal.fire({title: 'Updated!', text: 'Settings Saved Successfully!', icon: 'success', background: '#0f172a', color: '#f8fafc', confirmButtonColor: '#22c55e'}).then(() => { window.location.href = "/"; });</script></body>
        `);
    } catch (error) { res.send(`Error: ${error.message}`); }
});

const ADMIN_PORT = 4000;
adminApp.listen(ADMIN_PORT, () => { 
    console.log(`🔐 Master Administrator Panel is LIVE on Port ${ADMIN_PORT}`); 
});

// ==========================================
// 🔥 ADVANCED SERVER STATS (THE VAULT STYLE) 🔥
// ==========================================
const WELCOME_CHANNEL_ID = '1509523189389332480'; 
const STATS_DATE_ID = '1509533726902849586';      
const STATS_TOTAL_ID = '1509533817986089062';     
const STATS_ONLINE_ID = '1509533898949005373';    

const updateServerStats = async (guild) => {
    try {
        await guild.members.fetch({ withPresences: true });

        const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
        const day = d.getDate();
        const suffix = ["th", "st", "nd", "rd"][((day % 10 > 3) || (Math.floor(day % 100 / 10) === 1)) ? 0 : day % 10];
        const dayName = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(d);
        const monthName = new Intl.DateTimeFormat('en-US', { month: 'short' }).format(d);
        const todayDate = `${dayName}, ${day}${suffix} ${monthName}`;

        const dateChannel = guild.channels.cache.get(STATS_DATE_ID);
        if (dateChannel) dateChannel.setName(`📅 | ${todayDate}`).catch(()=>{});

        const totalChannel = guild.channels.cache.get(STATS_TOTAL_ID);
        if (totalChannel) totalChannel.setName(`🏦 | Total Traders: ${guild.memberCount}`).catch(()=>{});

        const onlineCount = guild.presences.cache.filter(presence => {
            const member = guild.members.cache.get(presence.userId);
            return member && !member.user.bot && ['online', 'idle', 'dnd'].includes(presence.status);
        }).size;
        
        const onlineChannel = guild.channels.cache.get(STATS_ONLINE_ID);
        if (onlineChannel) onlineChannel.setName(`🟢 | Active Now: ${onlineCount}`).catch(()=>{});

    } catch (error) {
        console.error("Stats update error:", error);
    }
};

client.on('ready', () => {
    console.log("Vault Style Stats Activated!");
    client.guilds.cache.forEach(guild => updateServerStats(guild));
    setInterval(() => {
        client.guilds.cache.forEach(guild => updateServerStats(guild));
    }, 10 * 60 * 1000); 
});

client.on('guildMemberAdd', async (member) => {
    const welcomeChannel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
    if (welcomeChannel) {
        welcomeChannel.send(`Hey <@${member.id}>, welcome to the community! 🎉`);
    }
});

// ==========================================
// 🛡️ ANTI-CRASH SYSTEM
// ==========================================
process.on('unhandledRejection', (reason, promise) => {
    console.log('❌ [ANTI-CRASH] Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (err, origin) => {
    console.log('❌ [ANTI-CRASH] Uncaught Exception:', err, 'Origin:', origin);
});
process.on('uncaughtExceptionMonitor', (err, origin) => {
    console.log('❌ [ANTI-CRASH] Uncaught Exception Monitor:', err, 'Origin:', origin);
});

client.login(process.env.DISCORD_TOKEN);