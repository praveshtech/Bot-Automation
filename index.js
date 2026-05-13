require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    StringSelectMenuBuilder,
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle, 
    PermissionsBitField,
    ChannelType,
    AttachmentBuilder
} = require('discord.js');

const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

// ==========================================
// 1. FIREBASE SETUP
// ==========================================
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore(); 

let globalLastUpdate = Date.now();

// ==========================================
// 2. DISCORD BOT INIT
// ==========================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers 
    ]
});

const userSelections = new Map();

client.once('ready', () => {
    console.log(`✅ BOT ONLINE: Logged in as ${client.user.tag}`);
    console.log(`🔥 FIREBASE: Connected Successfully`);

    // Background loop: Har 1 ghante me leaderboards refresh karega
    setInterval(() => {
        client.guilds.cache.forEach(guild => {
            updateWeeklyLeaderboard(guild);
            updateHeistLeaderboard(guild); // Naya Heist Leaderboard Loop
        });
    }, 60 * 60 * 1000);
});

// ==========================================
// 🛠️ DISCORD COMMANDS (Admin Setup)
// ==========================================
client.on('messageCreate', async message => {
    if (message.author.bot) return;

    const command = message.content.trim().toLowerCase();

    // 🔥 P2P COMMAND
    if (command === '!p2p') {
        if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply({ content: "❌ Action Denied: Only Administrators can run this command.", ephemeral: true });
        }
        
        try {
            const setupEmbed = new EmbedBuilder()
                .setColor('#2b2d31')
                .setTitle('🏦 Exchange Desk (P2P)')
                .setDescription('Welcome to the Professor Network.\n\nClick the button below to start trading securely.')
                .setFooter({ text: 'Automated by Professor Network' });
                
            const buttons = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('start_p2p_trade').setLabel('🚀 Start Trade').setStyle(ButtonStyle.Primary)
            );

            await message.channel.send({ embeds: [setupEmbed], components: [buttons] });
            await message.delete().catch(() => {});
        } catch (err) {
            console.error("❌ Error in !p2p command:", err);
        }
    }

    // 🔥 VERIFY COMMAND
    if (command === '!verify') {
        if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        
        try {
            const kycEmbed = new EmbedBuilder()
                .setColor('#2b2d31')
                .setTitle('📝 𝕭𝖆𝖘𝖎𝖈 𝕹𝖊𝖙𝖜𝖔𝖗𝖐 𝕽𝖊𝖌𝖎𝖘𝖙𝖗𝖆𝖙𝖎𝖔𝖓')
                .setDescription('> **To join the community legally, submit your basic details here.**\n\n`Note: If You Want $0 Fee on P2P trades use P2P WITH KYC, a separate ID verification is required at the Exchange Desk.`')
                .setFooter({ text: '🔒 Data is encrypted and stored securely.' });
                
            const kycButton = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('start_kyc_form').setLabel('Verify').setStyle(ButtonStyle.Primary).setEmoji('📝')
            );
            
            await message.channel.send({ embeds: [kycEmbed], components: [kycButton] });
            await message.delete().catch(()=>{});
        } catch (err) {
            console.error("❌ Error in !verify command:", err);
        }
    }

    // 🔥 DASHBOARD COMMAND
    if (command === '!setupdashboard') {
        if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        
        try {
            const dashEmbed = new EmbedBuilder()
                .setColor('#2b2d31')
                .setTitle('🏦 THE VAULT | EXECUTIVE DASHBOARD')
                .setDescription('**[ 🔴 SYSTEM STATUS: STANDBY ]**\n\nClick the **Sync Network Data** button below to securely fetch the latest real-time analytics from the central database.')
                .setFooter({ text: 'Professor Network - Secure Terminal' });
                
            const refreshBtn = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('refresh_dashboard').setLabel('🔄 Sync Network Data').setStyle(ButtonStyle.Primary));
            
            await message.channel.send({ embeds: [dashEmbed], components: [refreshBtn] });
            await message.delete().catch(()=>{});
        } catch (err) {
            console.error("❌ Error in dashboard command:", err);
        }
    }

    // 🔥 WEEKLY LEADERBOARD COMMAND
    if (command === '!setupleaderboard') {
        if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        
        try {
            let leaderboardChannel = message.guild.channels.cache.find(c => c.name === '📈・weekly-ledger' || c.name === 'weekly-ledger');
            
            if (!leaderboardChannel) {
                leaderboardChannel = await message.guild.channels.create({ 
                    name: '📈・weekly-ledger', 
                    type: ChannelType.GuildText, 
                    permissionOverwrites: [
                        { id: message.guild.id, deny: [PermissionsBitField.Flags.SendMessages], allow: [PermissionsBitField.Flags.ViewChannel] },
                        { id: client.user.id, allow: [PermissionsBitField.Flags.SendMessages] }
                    ] 
                });
            }

            await message.reply({ content: `✅ Weekly Leaderboard setup in ${leaderboardChannel}. It will auto-update!`, ephemeral: true });
            await message.delete().catch(()=>{});
            updateWeeklyLeaderboard(message.guild);
        } catch (err) {
            console.error("❌ Error setting up leaderboard:", err);
        }
    }

    // 🔥 NAYA: HEIST POINTS LEADERBOARD COMMAND
    if (command === '!setupheistboard') {
        if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        
        try {
            let heistChannel = message.guild.channels.cache.find(c => c.name === '✨・heist-points' || c.name === 'heist-leaderboard');
            
            if (!heistChannel) {
                heistChannel = await message.guild.channels.create({ 
                    name: '✨・heist-points', 
                    type: ChannelType.GuildText, 
                    permissionOverwrites: [
                        { id: message.guild.id, deny: [PermissionsBitField.Flags.SendMessages], allow: [PermissionsBitField.Flags.ViewChannel] },
                        { id: client.user.id, allow: [PermissionsBitField.Flags.SendMessages] }
                    ] 
                });
            }

            await message.reply({ content: `✅ Heist Points Leaderboard setup in ${heistChannel}. It will auto-update!`, ephemeral: true });
            await message.delete().catch(()=>{});
            updateHeistLeaderboard(message.guild);
        } catch (err) {
            console.error("❌ Error setting up heist leaderboard:", err);
        }
    }
});

// ==========================================
// 🖱️ INTERACTION LOGIC
// ==========================================
client.on('interactionCreate', async interaction => {

    // --- 📊 0. DASHBOARD SYNC ---
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
                const discordId = data.discordUserId; 
                const username = data.username || 'Unknown';
                const userTag = discordId ? `<@${discordId}>` : `@${username}`;
                
                if (userVolumes[userTag]) { 
                    userVolumes[userTag] += amount; 
                } else { 
                    userVolumes[userTag] = amount; 
                }

                if (data.closedAt && typeof data.closedAt.toDate === 'function') {
                    const tradeDate = data.closedAt.toDate();
                    const diffTime = Math.abs(now - tradeDate);
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
                    
                    if (diffDays <= 1) dailyVol += amount;
                    if (diffDays <= 7) weeklyVol += amount;
                    if (diffDays <= 30) monthlyVol += amount;
                }
            });

            const topTraders = Object.keys(userVolumes).map(tag => ({ tag, totalVolume: userVolumes[tag] })).sort((a, b) => b.totalVolume - a.totalVolume).slice(0, 5);
            let whalesText = '';
            const medals = ['🥇', '🥈', '🥉', '🏅', '🏅'];
            
            if (topTraders.length === 0) {
                whalesText = 'No data available yet.';
            } else {
                topTraders.forEach((trader, index) => { 
                    whalesText += `${medals[index]} ${trader.tag} ━━ **$${trader.totalVolume}**\n`; 
                });
            }

            const updatedDashEmbed = new EmbedBuilder()
                .setColor('#2ecc71') 
                .setTitle('🏦 THE VAULT | EXECUTIVE DASHBOARD')
                .setDescription('**[ 🟢 SYSTEM STATUS: ONLINE ]**\nReal-time network analytics securely fetched from the central database.')
                .addFields(
                    { name: '👥 Network Strength', value: `\`\`\`yaml\nTotal Live Members : ${liveMembers}\n\`\`\``, inline: false },
                    { name: '📈 Transaction Analytics', value: `\`\`\`yaml\nDaily (24h)   : $${dailyVol}\nWeekly (7d)   : $${weeklyVol}\nMonthly (30d) : $${monthlyVol}\n\`\`\``, inline: false },
                    { name: '🏆 Top 5 Network Whales', value: whalesText, inline: false }
                )
                .setTimestamp().setFooter({ text: 'Professor Network - Secure Terminal', iconURL: client.user.displayAvatarURL() });

            await interaction.editReply({ embeds: [updatedDashEmbed] });
        } catch (error) {
            console.error("Dashboard Sync Error:", error);
            await interaction.followUp({ content: '❌ Data fetch karne mein error aaya!', ephemeral: true });
        }
    }

   // --- 🌟 FEEDBACK SYSTEM CONFIRM BUTTON ---
    if (interaction.isButton() && interaction.customId.startsWith('confirm_feedback_')) {
        const expectedUserId = interaction.customId.replace('confirm_feedback_', '');
        
        if (interaction.user.id !== expectedUserId) {
            return interaction.reply({ content: '❌ Action Denied.', ephemeral: true });
        }

        await interaction.deferUpdate();

        // 🔥 NAYA UPDATE: Bot ab pichle 15 messages check karega
        const messages = await interaction.channel.messages.fetch({ limit: 15 });
        const userMessages = messages.filter(m => m.author.id === expectedUserId);

        let reviewText = "";
        let imageAttachment = null;

        // User ke sabhi messages mein se Text aur Photo alag-alag nikalna
        userMessages.forEach(m => {
            if (m.content.trim() !== '' && reviewText === "") {
                reviewText = m.content; // Jo text mila use save kar lo
            }
            if (m.attachments.size > 0 && !imageAttachment) {
                imageAttachment = m.attachments.first(); // Jo photo mili use save kar lo
            }
        });

        // Agar user ne na text bheja, na photo
        if (reviewText === "" && !imageAttachment) {
            return interaction.followUp({ content: '⚠️ Please write a message or upload a screenshot before clicking Confirm!', ephemeral: true });
        }

        // Agar user ne sirf photo bheji aur text type nahi kiya (tab fallback use hoga)
        if (reviewText === "") {
            reviewText = "Awesome and fast trade! 🚀"; 
        }

        let tradeInfo = interaction.channel.topic || "P2P Trade"; 

        let reviewChannel = interaction.guild.channels.cache.find(c => c.name === 'transaction-reviews' || c.name === 'reviews');
        if (!reviewChannel) {
            reviewChannel = await interaction.guild.channels.create({
                name: 'transaction-reviews',
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: interaction.guild.id, allow: [PermissionsBitField.Flags.ViewChannel], deny: [PermissionsBitField.Flags.SendMessages] },
                    { id: client.user.id, allow: [PermissionsBitField.Flags.SendMessages] }
                ]
            });
        }

        const reviewEmbed = new EmbedBuilder()
            .setColor('#f1c40f')
            .setAuthor({ name: `${interaction.user.username}'s Feedback`, iconURL: interaction.user.displayAvatarURL() })
            .setDescription(`💬 **Review:**\n> ${reviewText}`)
            .addFields({ name: '🔄 Trade Info', value: `\`${tradeInfo}\``, inline: true })
            .setTimestamp()
            .setFooter({ text: '💎 Professor Network - Trusted P2P', iconURL: client.user.displayAvatarURL() });

        let filesToUpload = [];

        if (imageAttachment) {
            const proofImage = new AttachmentBuilder(imageAttachment.url, { name: 'feedback-proof.png' });
            reviewEmbed.setImage('attachment://feedback-proof.png');
            filesToUpload.push(proofImage);
        }

        await reviewChannel.send({ content: `🔔 **New Transaction Review!** | @everyone`, embeds: [reviewEmbed], files: filesToUpload });

        await interaction.followUp({ content: '✅ Your feedback has been published! Thank you for trusting The Vault. Closing room...', ephemeral: true });

        setTimeout(() => interaction.channel.delete().catch(()=> {}), 5000);
    }
    
   // --- 🛡️ 1. AUTO-KYC & ACCESS RESTORE LOGIC ---
    if (interaction.isButton() && interaction.customId === 'start_kyc_form') {
        
        const existingKyc = await db.collection('users_kyc').doc(interaction.user.id).get();
        if (existingKyc.exists && existingKyc.data().status === 'Approved') {
            
            let basicRole = interaction.guild.roles.cache.find(r => r.name === 'Verified');
            if (!basicRole) { 
                basicRole = await interaction.guild.roles.create({ name: 'Verified', color: '#3498db' }); 
            }
            await interaction.member.roles.add(basicRole).catch(console.error);

            return interaction.reply({ content: '✅ **Welcome Back!** You Are Already a Verified Member. Your server access has been automatically restored.', ephemeral: true });
        }

        const kycModal = new ModalBuilder().setCustomId('submit_kyc_modal').setTitle('🛡️ Instant Verification Form');
        
        const welcomeMessageField = new TextInputBuilder()
            .setCustomId('welcome_message')
            .setLabel('🙏 Welcome To Professor Network')
            .setStyle(TextInputStyle.Paragraph)
            .setValue('💎 Trusted P2P Platform For Usdt Buy/Sell') 
            .setRequired(false); 

        kycModal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('kyc_name').setLabel('Full Name / Alias').setStyle(TextInputStyle.Short).setRequired(true)), 
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('kyc_discord_contact').setLabel('Discord ID / Name').setStyle(TextInputStyle.Short).setRequired(true)), 
            new ActionRowBuilder().addComponents(welcomeMessageField) 
        );
        
        await interaction.showModal(kycModal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'submit_kyc_modal') {
        await interaction.deferReply({ ephemeral: true });

        try {
            const existingKyc = await db.collection('users_kyc').doc(interaction.user.id).get();
            if (existingKyc.exists && existingKyc.data().status === 'Approved') {
                return interaction.editReply({ content: `✅ **Action Denied:** Your profile is already **Registered**.` });
            }

            const name = interaction.fields.getTextInputValue('kyc_name');
            const discordContactVal = interaction.fields.getTextInputValue('kyc_discord_contact');
            
            await db.collection('users_kyc').doc(interaction.user.id).set({ 
                discordId: interaction.user.id, 
                username: interaction.user.username, 
                name: name, 
                discordContact: discordContactVal, 
                paymentInfo: 'N/A', 
                status: 'Approved', 
                createdAt: admin.firestore.FieldValue.serverTimestamp() 
            });

            let basicRole = interaction.guild.roles.cache.find(r => r.name === 'Verified');
            if (!basicRole) { 
                basicRole = await interaction.guild.roles.create({ name: 'Verified', color: '#3498db' }); 
            }
            await interaction.member.roles.add(basicRole).catch(console.error);

            globalLastUpdate = Date.now(); 
            await interaction.editReply({ content: '✅ **Registration Successful!** You have received the **Verified** role and basic channels are now unlocked.\n*(Note: To get the **Vault Verified** tag for $0 Fee On P2P Trades, Select "P2P With KYC" at the Exchange Desk).*' });

        } catch (error) {
            console.error("KYC Auto-Approve Error:", error);
            await interaction.editReply({ content: '❌ Something went wrong while saving your data. Please contact support.' });
        }
    }

    // --- 🔥 DYNAMIC 1-MESSAGE P2P TRADE FLOW ---
    if (interaction.isButton() && interaction.customId === 'start_p2p_trade') {
        const modeEmbed = new EmbedBuilder()
            .setColor('#3498db')
            .setAuthor({ name: '🏦 P2P Trade Setup | Mode Selection', iconURL: client.user.displayAvatarURL() })
            .setDescription('Please choose your trade mode:\n\n🛡️ **P2P With KYC:** $0 Fee (Requires Vault Verified tag)\n💸 **P2P Without KYC:** $3 Fee (Instant, No ID required)');
            
        const modeButtons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('start_p2p_with_kyc').setLabel('🛡️ P2P With KYC').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('start_p2p_without_kyc').setLabel('💸 P2P Without KYC').setStyle(ButtonStyle.Secondary)
        );

        await interaction.reply({ embeds: [modeEmbed], components: [modeButtons], ephemeral: true });
    }

    if (interaction.isButton() && (interaction.customId === 'start_p2p_with_kyc' || interaction.customId === 'start_p2p_without_kyc')) {
        
        const isVerifiedRoute = interaction.customId === 'start_p2p_with_kyc';
        const hasRole = interaction.member.roles.cache.some(role => role.name === 'Vault Verified');

        // 🔥 Yahan Admin bypass hata diya hai taaki Admin ka bhi KYC form open ho sake for testing
        if (isVerifiedRoute && !hasRole) {
            
            await interaction.update({ content: '⏳ Creating your secure KYC verification room...', embeds: [], components: [] });

            try {
                await db.collection('users_kyc').doc(interaction.user.id).set({ 
                    discordId: interaction.user.id, 
                    username: interaction.user.username, 
                    status: 'Pending', 
                    kycType: 'Advanced (Vault Verified)', 
                    updatedAt: admin.firestore.FieldValue.serverTimestamp() 
                }, { merge: true }); 
                
                globalLastUpdate = Date.now(); 
            } catch (error) {
                console.error("DB Pending Update Error:", error);
            }

            const palermoRole = interaction.guild.roles.cache.find(role => role.name === 'Palermo');
            const channelPermissions = [
                { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles] }
            ];
            
            if (palermoRole) {
                channelPermissions.push({ id: palermoRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] });
            }

            const kycChannel = await interaction.guild.channels.create({
                name: `kyc-${interaction.user.username}`,
                type: ChannelType.GuildText,
                permissionOverwrites: channelPermissions
            });

            const kycEmbed = new EmbedBuilder()
                .setColor('#3498db')
                .setAuthor({ name: '🛡️ Advanced KYC Verification', iconURL: client.user.displayAvatarURL() })
                .setDescription(
                    `Welcome ${interaction.user.toString()}!\n\n` +
                    `To unlock **$0 Fee Trades (P2P With KYC)**, we need to verify your real identity.\n\n` +
                    `Please upload:\n` +
                    `1️⃣ **A clear photo of your National ID**\n` +
                    `2️⃣ **A selfie of you holding the ID**\n\n` +
                    `Send the images directly in this chat. Our Admin will review them shortly.`
                )
                .setFooter({ text: 'Professor Network - Secure KYC' });

            const kycAdminButtons = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`approve_kyc_${interaction.user.id}`).setLabel('✅ Approve KYC').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`reject_kyc_${interaction.user.id}`).setLabel('❌ Reject KYC').setStyle(ButtonStyle.Danger)
            );

            await kycChannel.send({ content: `🔔 Admin Notification: New Advanced KYC Pending for ${interaction.user.toString()}`, embeds: [kycEmbed], components: [kycAdminButtons] });

            await interaction.editReply({ content: `✅ KYC Room created! Please head over to ${kycChannel} to submit your documents.\n\n*(This message will auto-delete in 15 seconds)*` });
            
            setTimeout(() => {
                interaction.deleteReply().catch(() => {});
            }, 15000);
            return;
        }

        userSelections.set(interaction.user.id, { type: null, step2: null, step3: null, amount: null, isVerifiedTrade: isVerifiedRoute });
        
        const typeDropdown = new StringSelectMenuBuilder().setCustomId('dropdown_type').setPlaceholder('Select Action: Buy or Sell').addOptions([
            { label: 'Buy USDT (Pay INR)', value: 'Buy', emoji: '🟢' }, 
            { label: 'Sell USDT (Get INR)', value: 'Sell', emoji: '🔴' }
        ]);
        const row1 = new ActionRowBuilder().addComponents(typeDropdown);
        
        const step1Embed = new EmbedBuilder()
            .setColor('#3498db')
            .setAuthor({ name: '🏦 P2P Trade Setup | Step 1', iconURL: client.user.displayAvatarURL() })
            .setDescription(`**Mode:** ${isVerifiedRoute ? '✅ KYC ($0 Fee)' : '⚠️ Non-KYC (Up to $3 Fee)'}\n\nPlease select whether you want to **Buy** or **Sell** Crypto from the dropdown below.`);

        await interaction.update({ content: '', embeds: [step1Embed], components: [row1] });
    }

    // --- 🛡️ ADVANCED KYC APPROVE / REJECT HANDLERS ---
    if (interaction.isButton() && interaction.customId.startsWith('approve_kyc_')) {
        const userId = interaction.customId.replace('approve_kyc_', '');
        
        const isPalermo = interaction.member.roles.cache.some(role => role.name === 'Palermo');
        const isProfessor = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
        
        if (!isProfessor && !isPalermo) {
            return interaction.reply({ content: '❌ **Access Denied:** Only Admins can approve KYC.', ephemeral: true });
        }

        await interaction.deferUpdate(); 
        await approveUserKYC(userId, interaction.guild);
        
        const oldEmbed = interaction.message.embeds[0];
        const updatedEmbed = EmbedBuilder.from(oldEmbed).setColor('#2ecc71').setTitle('✅ KYC Approved');
        
        await interaction.editReply({ embeds: [updatedEmbed], components: [] });
        await interaction.followUp({ content: `✅ Successfully verified <@${userId}>! They received the Vault Verified role. This room will close in 5 seconds.`, ephemeral: true });
        
        const exchangeChannel = interaction.guild.channels.cache.find(c => c.name === 'exchange-desk' || c.name.includes('exchange'));
        if (exchangeChannel) {
            try {
                const fetchedMessages = await exchangeChannel.messages.fetch({ limit: 10 });
                const botMessages = fetchedMessages.filter(m => m.author.id === client.user.id);
                for (const [id, msg] of botMessages) {
                    await msg.delete().catch(() => {});
                }
                
                const setupEmbed = new EmbedBuilder()
                    .setColor('#2b2d31')
                    .setTitle('🏦 Exchange Desk (P2P)')
                    .setDescription('Welcome to the Professor Network.\n\nClick the button below to start trading securely.')
                    .setFooter({ text: 'Automated by Professor Network' });
                    
                const buttons = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('start_p2p_trade').setLabel('🚀 Start Trade').setStyle(ButtonStyle.Primary)
                );
                await exchangeChannel.send({ embeds: [setupEmbed], components: [buttons] });
            } catch (err) {
                console.error("Exchange desk refresh error:", err);
            }
        }

        if (interaction.channel.name.startsWith('kyc-') && interaction.channel.name !== 'kyc-requests') {
            setTimeout(() => interaction.channel.delete().catch(()=> {}), 5000);
        }
    }

    if (interaction.isButton() && interaction.customId.startsWith('reject_kyc_')) {
        const userId = interaction.customId.replace('reject_kyc_', '');

        const isPalermo = interaction.member.roles.cache.some(role => role.name === 'Palermo');
        const isProfessor = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
        
        if (!isProfessor && !isPalermo) {
            return interaction.reply({ content: '❌ **Access Denied:** Only Admins can reject KYC.', ephemeral: true });
        }

        await interaction.deferUpdate();
        await db.collection('users_kyc').doc(userId).update({ status: 'Rejected' }).catch(()=>{});
        globalLastUpdate = Date.now(); 

        const oldEmbed = interaction.message.embeds[0];
        const updatedEmbed = EmbedBuilder.from(oldEmbed).setColor('#e74c3c').setTitle('❌ KYC Rejected');
        
        await interaction.editReply({ embeds: [updatedEmbed], components: [] });
        await interaction.followUp({ content: `❌ KYC Rejected for <@${userId}>. This room will close in 5 seconds.`, ephemeral: true });
        
        if (interaction.channel.name.startsWith('kyc-') && interaction.channel.name !== 'kyc-requests') {
            setTimeout(() => interaction.channel.delete().catch(()=> {}), 5000);
        }
    }

    // --- DYNAMIC DROPDOWN LOGIC ---
    if (interaction.isStringSelectMenu()) {
        const userState = userSelections.get(interaction.user.id) || { type: null, step2: null, step3: null, amount: null, isVerifiedTrade: false };
        
        if (interaction.customId === 'dropdown_type') {
            userState.type = interaction.values[0];
            userState.step2 = null;
            userState.step3 = null;
            userState.amount = null;
            userSelections.set(interaction.user.id, userState);
            
            const amountModal = new ModalBuilder().setCustomId('amount_modal_popup').setTitle(`🏦 Trade Amount (${userState.type} Crypto)`);
            const amountInput = new TextInputBuilder().setCustomId('trade_amount_input').setLabel('Enter Amount in USDT ($)').setPlaceholder('e.g. 5000').setStyle(TextInputStyle.Short).setRequired(true);
            amountModal.addComponents(new ActionRowBuilder().addComponents(amountInput));
            
            await interaction.showModal(amountModal);
            return; 
        }
        
        if (interaction.customId === 'dropdown_step2' || interaction.customId === 'dropdown_step3') {
            if (interaction.customId === 'dropdown_step2') {
                userState.step2 = interaction.values[0];
                userState.step3 = null;
            } else {
                userState.step3 = interaction.values[0];
            }
            userSelections.set(interaction.user.id, userState);
            
            const typeDropdown = new StringSelectMenuBuilder().setCustomId('dropdown_type').addOptions([{ label: 'Buy USDT (Pay INR)', value: 'Buy', emoji: '🟢', default: userState.type === 'Buy' }, { label: 'Sell USDT (Get INR)', value: 'Sell', emoji: '🔴', default: userState.type === 'Sell' }]);
            const step2Dropdown = new StringSelectMenuBuilder().setCustomId('dropdown_step2');
            
            if (userState.type === 'Sell') {
                step2Dropdown.addOptions([
                    { label: 'TRC20 (Tron)', value: 'TRC20', emoji: '🔗', default: userState.step2 === 'TRC20' }, 
                    { label: 'ERC20 (Ethereum)', value: 'ERC20', emoji: '💎', default: userState.step2 === 'ERC20' }, 
                    { label: 'BEP20 (Binance)', value: 'BEP20', emoji: '🟡', default: userState.step2 === 'BEP20' }, 
                    { label: 'BTC (Bitcoin)', value: 'BTC', emoji: '🪙', default: userState.step2 === 'BTC' }
                ]);
            } else {
                step2Dropdown.addOptions([
                    { label: 'UPI', value: 'UPI', emoji: '📱', default: userState.step2 === 'UPI' }, 
                    { label: 'IMPS/Bank Transfer', value: 'IMPS', emoji: '🏦', default: userState.step2 === 'IMPS' }, 
                    { label: 'Cash Deposit (CDM)', value: 'CDM', emoji: '🏧', default: userState.step2 === 'CDM' }
                ]);
            }
            
            const row1 = new ActionRowBuilder().addComponents(typeDropdown);
            const row2 = new ActionRowBuilder().addComponents(step2Dropdown);
            const components = [row1, row2];

            const stepEmbed = new EmbedBuilder()
                .setColor('#3498db')
                .addFields(
                    { name: '🔄 Action', value: `${userState.type === 'Buy' ? '🟢 Buy USDT' : '🔴 Sell USDT'}`, inline: true },
                    { name: '💰 Amount', value: `$${userState.amount}`, inline: true },
                    { name: '🌐 Network/Method', value: `${userState.step2 || 'Pending'}`, inline: true }
                );

            if (userState.type === 'Sell') {
                const step3Dropdown = new StringSelectMenuBuilder().setCustomId('dropdown_step3').setPlaceholder('Select Receiving Method');
                step3Dropdown.addOptions([
                    { label: 'IMPS (Bank Transfer)', value: 'IMPS', emoji: '🏦', default: userState.step3 === 'IMPS' },
                    { label: 'CDM (Cash Deposit)', value: 'CDM', emoji: '🏧', default: userState.step3 === 'CDM' },
                    { label: 'CCW', value: 'CCW', emoji: '💳', default: userState.step3 === 'CCW' }
                ]);
                components.push(new ActionRowBuilder().addComponents(step3Dropdown));

                if (userState.step3) {
                    const nextButton = new ButtonBuilder().setCustomId('proceed_to_details').setLabel('Next (Enter Bank Details)').setStyle(ButtonStyle.Success);
                    components.push(new ActionRowBuilder().addComponents(nextButton));
                    
                    stepEmbed.setAuthor({ name: '🏦 P2P Trade Setup | Final Step', iconURL: client.user.displayAvatarURL() })
                             .setColor('#2ecc71')
                             .setDescription('Click the **Next** button below to securely enter your bank details.')
                             .addFields({ name: '🏦 Receiving Method', value: `${userState.step3}`, inline: true });
                             
                    await interaction.update({ content: '', embeds: [stepEmbed], components });
                } else {
                    stepEmbed.setAuthor({ name: '🏦 P2P Trade Setup | Step 3', iconURL: client.user.displayAvatarURL() })
                             .setDescription('Please select how you want to receive your INR from the dropdown below.');
                             
                    await interaction.update({ content: '', embeds: [stepEmbed], components });
                }
            } else {
                const nextButton = new ButtonBuilder().setCustomId('proceed_to_details').setLabel('Next (Enter Wallet Details)').setStyle(ButtonStyle.Success);
                components.push(new ActionRowBuilder().addComponents(nextButton));
                
                stepEmbed.setAuthor({ name: '🏦 P2P Trade Setup | Final Step', iconURL: client.user.displayAvatarURL() })
                         .setColor('#2ecc71')
                         .setDescription('Click the **Next** button below to securely enter your wallet details.');
                         
                await interaction.update({ content: '', embeds: [stepEmbed], components });
            }
        }
    }

    if (interaction.isModalSubmit() && interaction.customId === 'amount_modal_popup') {
        const userState = userSelections.get(interaction.user.id);
        userState.amount = interaction.fields.getTextInputValue('trade_amount_input');
        userSelections.set(interaction.user.id, userState);

        const typeDropdown = new StringSelectMenuBuilder().setCustomId('dropdown_type').addOptions([{ label: 'Buy USDT (Pay INR)', value: 'Buy', emoji: '🟢', default: userState.type === 'Buy' }, { label: 'Sell USDT (Get INR)', value: 'Sell', emoji: '🔴', default: userState.type === 'Sell' }]);
        const step2Dropdown = new StringSelectMenuBuilder().setCustomId('dropdown_step2');
        
        if (userState.type === 'Sell') {
            step2Dropdown.setPlaceholder('Select Crypto Network').addOptions([{ label: 'TRC20 (Tron)', value: 'TRC20', emoji: '🔗' }, { label: 'ERC20 (Ethereum)', value: 'ERC20', emoji: '💎' }, { label: 'BEP20 (Binance)', value: 'BEP20', emoji: '🟡' }, { label: 'BTC (Bitcoin)', value: 'BTC', emoji: '🪙' }]);
        } else {
            step2Dropdown.setPlaceholder('Choose Payment Method').addOptions([{ label: 'UPI', value: 'UPI', emoji: '📱' }, { label: 'IMPS/Bank Transfer', value: 'IMPS', emoji: '🏦' }, { label: 'Cash Deposit (CDM)', value: 'CDM', emoji: '🏧' }]);
        }

        const row1 = new ActionRowBuilder().addComponents(typeDropdown);
        const row2 = new ActionRowBuilder().addComponents(step2Dropdown);

        const step2Embed = new EmbedBuilder()
            .setColor('#3498db')
            .setAuthor({ name: '🏦 P2P Trade Setup | Step 2', iconURL: client.user.displayAvatarURL() })
            .setDescription(`Please select your **${userState.type === 'Sell' ? 'Crypto Network' : 'Payment Method'}** from the dropdown below.`)
            .addFields(
                { name: '🔄 Action', value: `${userState.type === 'Buy' ? '🟢 Buy USDT' : '🔴 Sell USDT'}`, inline: true },
                { name: '💰 Amount', value: `$${userState.amount}`, inline: true }
            );

        await interaction.update({ content: '', embeds: [step2Embed], components: [row1, row2] });
    }

    if (interaction.isButton() && interaction.customId === 'proceed_to_details') {
        const userState = userSelections.get(interaction.user.id);
        const p2pModal = new ModalBuilder().setCustomId('final_p2p_modal').setTitle(`🏦 Details: ${userState.type} USDT`);
        
        if (userState.type === 'Sell') {
            if (userState.step3 === 'IMPS') {
                const bankName = new TextInputBuilder().setCustomId('bank_name').setLabel('Bank Name').setPlaceholder('e.g. HDFC Bank').setStyle(TextInputStyle.Short).setRequired(true);
                const accName = new TextInputBuilder().setCustomId('account_name').setLabel('Account Holder Name').setPlaceholder('e.g. Pravesh Yadav').setStyle(TextInputStyle.Short).setRequired(true);
                const accNo = new TextInputBuilder().setCustomId('account_number').setLabel('Account Number').setPlaceholder('e.g. 50100...').setStyle(TextInputStyle.Short).setRequired(true);
                const ifscCode = new TextInputBuilder().setCustomId('ifsc_code').setLabel('IFSC Code').setPlaceholder('e.g. HDFC0001234').setStyle(TextInputStyle.Short).setRequired(true);

                p2pModal.addComponents(
                    new ActionRowBuilder().addComponents(bankName),
                    new ActionRowBuilder().addComponents(accName),
                    new ActionRowBuilder().addComponents(accNo),
                    new ActionRowBuilder().addComponents(ifscCode)
                );
            } else if (userState.step3 === 'CDM') {
                const cdmAccName = new TextInputBuilder().setCustomId('cdm_account_name').setLabel('Account Holder Name').setPlaceholder('e.g. Pravesh Yadav').setStyle(TextInputStyle.Short).setRequired(true);
                const cdmAccNo = new TextInputBuilder().setCustomId('cdm_account_number').setLabel('Account Number').setPlaceholder('e.g. 50100...').setStyle(TextInputStyle.Short).setRequired(true);
                const cdmMobNo = new TextInputBuilder().setCustomId('cdm_mobile_number').setLabel('Mobile Number').setPlaceholder('e.g. 9876543210').setStyle(TextInputStyle.Short).setRequired(true);

                p2pModal.addComponents(
                    new ActionRowBuilder().addComponents(cdmAccName),
                    new ActionRowBuilder().addComponents(cdmAccNo),
                    new ActionRowBuilder().addComponents(cdmMobNo)
                );
            } else if (userState.step3 === 'CCW') {
                const ccwRefNo = new TextInputBuilder().setCustomId('ccw_ref_number').setLabel('Phone Number').setPlaceholder('e.g. 9876543210').setStyle(TextInputStyle.Short).setRequired(true);
                const ccwAccName = new TextInputBuilder().setCustomId('ccw_account_name').setLabel('Account Holder Name').setPlaceholder('e.g. Pravesh Yadav').setStyle(TextInputStyle.Short).setRequired(true);

                p2pModal.addComponents(
                    new ActionRowBuilder().addComponents(ccwRefNo),
                    new ActionRowBuilder().addComponents(ccwAccName)
                );
            }
        } else {
            const walletInput = new TextInputBuilder().setCustomId('user_receiving_details').setLabel('Your Crypto Wallet Address (To receive)').setPlaceholder('Enter your wallet address here').setStyle(TextInputStyle.Short).setRequired(true);
            p2pModal.addComponents(new ActionRowBuilder().addComponents(walletInput));
        }
        
        await interaction.showModal(p2pModal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'final_p2p_modal') {
        const userState = userSelections.get(interaction.user.id);
        const tradeAmount = userState.amount; 
        let userDetails = "";

        if (userState.type === 'Sell') {
            if (userState.step3 === 'IMPS') {
                const bName = interaction.fields.getTextInputValue('bank_name');
                const aName = interaction.fields.getTextInputValue('account_name');
                const aNo = interaction.fields.getTextInputValue('account_number');
                const ifsc = interaction.fields.getTextInputValue('ifsc_code');
                userDetails = `Bank Name: ${bName}\nHolder Name: ${aName}\nAccount No: ${aNo}\nIFSC Code: ${ifsc}`;
            } else if (userState.step3 === 'CDM') {
                const aName = interaction.fields.getTextInputValue('cdm_account_name');
                const aNo = interaction.fields.getTextInputValue('cdm_account_number');
                const mobNo = interaction.fields.getTextInputValue('cdm_mobile_number');
                userDetails = `Holder Name: ${aName}\nAccount No: ${aNo}\nMobile No: ${mobNo}`;
            } else if (userState.step3 === 'CCW') {
                const rNo = interaction.fields.getTextInputValue('ccw_ref_number');
                const aName = interaction.fields.getTextInputValue('ccw_account_name');
                userDetails = `Reference No: ${rNo}\nHolder Name: ${aName}`;
            }
        } else {
            userDetails = interaction.fields.getTextInputValue('user_receiving_details');
        }

        await interaction.reply({ content: '🏦 Creating your secure P2P room...', ephemeral: true });

        const palermoRole = interaction.guild.roles.cache.find(role => role.name === 'Palermo');
        const verifiedRole = interaction.guild.roles.cache.find(role => role.name === 'Vault Verified');
        
        const channelPermissions = [
            { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }, 
            { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] } 
        ];
        
        if (verifiedRole) {
            channelPermissions.push({ id: verifiedRole.id, deny: [PermissionsBitField.Flags.ViewChannel] });
        }
        if (palermoRole) {
            channelPermissions.push({ id: palermoRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageMessages] });
        }

        const ticketChannel = await interaction.guild.channels.create({ name: `ticket-${interaction.user.username}`, type: ChannelType.GuildText, permissionOverwrites: channelPermissions });

        let adminProvides = ""; let easyCopyText = ""; 
        if (userState.type === 'Sell') {
            let walletAddress = "Waiting for Admin to provide address.";
            if (userState.step2 === 'TRC20') walletAddress = "TABCDEF1234567890YOURTRC20WALLETADDRESS";
            if (userState.step2 === 'ERC20') walletAddress = "0xABCDEF1234567890YOURERC20WALLETADDRESS";
            if (userState.step2 === 'BEP20') walletAddress = "0xBEP20ADDRESSEXAMPLE";
            if (userState.step2 === 'BTC') walletAddress = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
            adminProvides = `**Admin's Crypto Address:**\n\`\`\`${walletAddress}\`\`\``; easyCopyText = walletAddress; 
        } else {
            let paymentDetails = "Waiting for Admin to provide bank details.";
            if (userState.step2 === 'UPI') paymentDetails = "admin@upi";
            if (userState.step2 === 'IMPS') paymentDetails = "Bank: SBI\nAcc: 123456789\nIFSC: SBIN0001234";
            if (userState.step2 === 'CDM') paymentDetails = "Cash Deposit Acc: 9876543210 (HDFC)";
            adminProvides = `**Admin's Bank/Payment Details:**\n\`\`\`${paymentDetails}\`\`\``; easyCopyText = paymentDetails; 
        }

        // 🔥 FEE SYSTEM REVERTED: No Level Discounts, Just Normal Fees
        const fee = userState.isVerifiedTrade ? 0 : 3;
        const totalToCollect = Number(tradeAmount) + fee;

        try {
            await db.collection('p2p_tickets').doc(ticketChannel.id).set({ 
                discordUserId: interaction.user.id, 
                username: interaction.user.username, 
                tradeType: userState.type, 
                networkOrMethod: userState.type === 'Sell' ? `${userState.step2} / ${userState.step3}` : userState.step2, 
                amountUsd: Number(tradeAmount), 
                fee: fee,
                isVerifiedTrade: userState.isVerifiedTrade,
                userReceivingDetails: userDetails, 
                adminTransferDetails: easyCopyText, 
                status: 'Open', 
                createdAt: admin.firestore.FieldValue.serverTimestamp() 
            });
            globalLastUpdate = Date.now(); 
        } catch (error) { console.error("Firebase Error: ", error); }

        const cinematicDescription = 
            `Welcome ${interaction.user.toString()}! Thanks for contacting the support team of **The Vault**.\n` +
            `Please follow the instructions below so we can complete your trade as quickly as possible.\n\n` +
            `**1. What is the action?**\n` +
            `> ${userState.type} USDT\n` +
            `**2. How much amount ($)?**\n` +
            `> $${tradeAmount}\n` +
            `**3. Which Method?**\n` +
            `> ${userState.type === 'Sell' ? userState.step2 + ' (Receive via ' + userState.step3 + ')' : userState.step2}\n\n` +
            `**Fee Structure:** $${fee} (Non-KYC Charge)\n` +
            `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n` +
            `**Please pay exactly: $${totalToCollect}**`;

        const ticketEmbed = new EmbedBuilder()
            .setColor(userState.isVerifiedTrade ? '#2ecc71' : '#e67e22')
            .setAuthor({ name: `🏦 Secure P2P Room (${userState.isVerifiedTrade ? 'Vault Verified' : 'Non-KYC'})`, iconURL: client.user.displayAvatarURL() })
            .setDescription(cinematicDescription)
            .setFooter({ text: 'Share your payment screenshot here after successful transfer.', iconURL: client.user.displayAvatarURL() });

        const actionButtonRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('complete_p2p_ticket').setLabel('✅ Mark Complete (Admin)').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('cancel_p2p_ticket').setLabel('❌ Cancel Trade').setStyle(ButtonStyle.Danger)
        );

        let pingMsg = palermoRole ? `🔔 <@&${palermoRole.id}> | Ping: ${interaction.user.toString()}` : `Ping: ${interaction.user.toString()}`;

        await ticketChannel.send({ 
            content: pingMsg, 
            embeds: [ticketEmbed], 
            components: [actionButtonRow] 
        });

        const revealButtonsRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('reveal_admin_details')
                .setLabel('👤 View Transfer Details (User Only)')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('reveal_user_details')
                .setLabel('👨‍💼 View User Details (Admin Only)')
                .setStyle(ButtonStyle.Secondary)
        );

        await ticketChannel.send({ 
            content: `🔒 **Secure Details Access**\nClick below to securely view the payment information. These details will only be visible to you.`, 
            components: [revealButtonsRow] 
        });

        await interaction.editReply({ content: `✅ Ticket created successfully! Click here to view: ${ticketChannel}` });
        userSelections.delete(interaction.user.id);
    }

    if (interaction.isButton() && interaction.customId === 'reveal_admin_details') {
        await interaction.deferReply({ ephemeral: true }); 
        try {
            const ticketDoc = await db.collection('p2p_tickets').doc(interaction.channel.id).get();
            if (ticketDoc.exists) {
                const data = ticketDoc.data();
                if (interaction.user.id !== data.discordUserId) {
                    return interaction.editReply({ content: '❌ **Access Denied:** Only the ticket creator can view this information.' });
                }
                await interaction.editReply({ content: `**Admin Transfer Details (Copy below):**\n\n${data.adminTransferDetails}` });
            } else {
                await interaction.editReply({ content: '❌ Ticket data not found.' });
            }
        } catch (err) { console.error(err); await interaction.editReply({ content: '❌ Error fetching details.' }); }
    }

    if (interaction.isButton() && interaction.customId === 'reveal_user_details') {
        await interaction.deferReply({ ephemeral: true }); 
        const isPalermo = interaction.member.roles.cache.some(role => role.name === 'Palermo');
        const isProfessor = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);

        if (!isProfessor && !isPalermo) {
            return interaction.editReply({ content: '❌ **Access Denied:** Only Admins/Palermo can view user details.' });
        }

        try {
            const ticketDoc = await db.collection('p2p_tickets').doc(interaction.channel.id).get();
            if (ticketDoc.exists) {
                const data = ticketDoc.data();
                await interaction.editReply({ content: `**User's Receiving Details (Copy below):**\n\n${data.userReceivingDetails}` });
            } else {
                await interaction.editReply({ content: '❌ Ticket data not found.' });
            }
        } catch (err) { console.error(err); await interaction.editReply({ content: '❌ Error fetching details.' }); }
    }

    if (interaction.isButton() && (interaction.customId === 'complete_p2p_ticket' || interaction.customId === 'cancel_p2p_ticket')) {
        const isPalermo = interaction.member.roles.cache.some(role => role.name === 'Palermo');
        const isProfessor = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
        const isAdmin = isProfessor || isPalermo;

        try {
            const ticketDoc = await db.collection('p2p_tickets').doc(interaction.channel.id).get();
            if (!ticketDoc.exists) {
                return interaction.reply({ content: '❌ Ticket data not found.', ephemeral: true });
            }
            
            const ticketData = ticketDoc.data();
            const isTicketCreator = interaction.user.id === ticketData.discordUserId;

            if (interaction.customId === 'complete_p2p_ticket' && !isAdmin) {
                return interaction.reply({ content: '❌ **Access Denied:** Only Admins can mark a trade as Complete.', ephemeral: true });
            }

            if (interaction.customId === 'cancel_p2p_ticket' && !isAdmin && !isTicketCreator) {
                return interaction.reply({ content: '❌ **Access Denied:** Only Admins or the Ticket Creator can cancel this trade.', ephemeral: true });
            }

            const isSuccess = interaction.customId === 'complete_p2p_ticket';
            const finalStatus = isSuccess ? 'Completed' : 'Cancelled';

            await interaction.reply({ content: `🔒 Ticket is being marked as **${finalStatus}** in 5 seconds...` });
            
            const member = await interaction.guild.members.fetch(ticketData.discordUserId).catch(() => null);
            if (member) {
                const receiptEmbed = new EmbedBuilder()
                    .setColor(isSuccess ? '#2ecc71' : '#e74c3c')
                    .setTitle(isSuccess ? '🧾 Transaction Completed' : '🚫 Transaction Cancelled')
                    .setDescription(`Hello **${ticketData.username}**,\n\nYour P2P transaction of **$${ticketData.amountUsd}** has been **${finalStatus}** by The Vault Admin.\n\n${isSuccess ? 'Thank you for trading with us! 🏦' : 'This transaction was incomplete and has been cancelled.'}`)
                    .setFooter({ text: 'Professor Network - Secure Terminal' });
                
                const serverLinkBtn = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Return to Exchange Desk').setStyle(ButtonStyle.Link).setURL('https://discord.gg/x9Aqjaef')); 
                await member.send({ embeds: [receiptEmbed], components: [serverLinkBtn] }).catch(()=> console.log("DM closed"));
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

            const vaultEmbed = new EmbedBuilder()
                .setColor(isSuccess ? '#f1c40f' : '#e74c3c') 
                .setTitle(`🏦 Vault Record: Transaction ${finalStatus}`)
                .addFields(
                    { name: '👤 User', value: String(ticketData.username || 'Unknown'), inline: true }, 
                    { name: '🔒 Handled By', value: String(interaction.user.username || 'Admin'), inline: true }, 
                    { name: 'Trade Type', value: String(ticketData.tradeType || 'Unknown'), inline: true }, 
                    { name: 'Amount', value: `$${ticketData.amountUsd || 0}`, inline: true }, 
                    { name: 'Method/Network', value: String(ticketData.networkOrMethod || 'Unknown'), inline: true }, 
                    { name: 'Status', value: `\`${finalStatus}\``, inline: true }
                )
                .setTimestamp().setFooter({ text: `Ticket ID: ${interaction.channel.id}` });
            await logChannel.send({ embeds: [vaultEmbed] });
            
            if (isSuccess) {
                let publicLogChannel = interaction.guild.channels.cache.find(c => c.name === 'public-transaction-log');
                
                if (!publicLogChannel) {
                    publicLogChannel = await interaction.guild.channels.create({ 
                        name: 'public-transaction-log', 
                        type: ChannelType.GuildText, 
                        permissionOverwrites: [
                            { id: interaction.guild.id, deny: [PermissionsBitField.Flags.SendMessages], allow: [PermissionsBitField.Flags.ViewChannel] },
                            { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                        ] 
                    });
                }

                const publicEmbed = new EmbedBuilder()
                    .setColor('#2ecc71') 
                    .setTitle('✅ Secure Trade Completed')
                    .setDescription(`Another successful transaction processed by **The Vault**! 🏦\n\n👤 **Trader:** <@${ticketData.discordUserId}>\n🔄 **Action:** ${ticketData.tradeType} Crypto\n💵 **Volume:** $${ticketData.amountUsd}\n💳 **Method:** ${ticketData.networkOrMethod}`)
                    .setTimestamp()
                    .setFooter({ text: 'Professor Network - Trusted P2P', iconURL: client.user.displayAvatarURL() });

                await publicLogChannel.send({ embeds: [publicEmbed] });
            }

            await db.collection('p2p_tickets').doc(interaction.channel.id).update({ 
                status: finalStatus, 
                closedBy: interaction.user.username, 
                closedAt: admin.firestore.FieldValue.serverTimestamp() 
            });

            globalLastUpdate = Date.now(); 

            if (isSuccess) {
                updateWeeklyLeaderboard(interaction.guild);
                
                // 🔥 NAYA: HEIST POINTS CALCULATION TRIGGER
                await updateUserHeistPoints(ticketData.discordUserId, interaction.guild, ticketData.username);
            }

            const mainTicketChannel = interaction.guild.channels.cache.find(c => c.name.includes('exchange') || c.name.includes('ticket') || c.name.includes('p2p'));
            if (mainTicketChannel) {
                const fetchedMessages = await mainTicketChannel.messages.fetch({ limit: 10 });
                const botMessages = fetchedMessages.filter(m => m.author.id === client.user.id);
                botMessages.forEach(msg => msg.delete().catch(console.error));
                
                const setupEmbed = new EmbedBuilder()
                    .setColor('#2b2d31')
                    .setTitle('🏦 Exchange Desk (P2P)')
                    .setDescription('Welcome to the Professor Network.\n\nClick the button below to start trading securely.')
                    .setFooter({ text: 'Automated by Professor Network' });
                    
                const buttons = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('start_p2p_trade').setLabel('🚀 Start Trade').setStyle(ButtonStyle.Primary)
                );
                await mainTicketChannel.send({ embeds: [setupEmbed], components: [buttons] });
            }

            if (isSuccess) {
                try {
                    const fbPerms = [
                        { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                        { id: ticketData.discordUserId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles] }
                    ];
                    const feedbackChannel = await interaction.guild.channels.create({
                        name: `feedback-${ticketData.username}`,
                        type: ChannelType.GuildText,
                        permissionOverwrites: fbPerms,
                        topic: `${ticketData.tradeType} | $${ticketData.amountUsd}` 
                    });

                    const fbEmbed = new EmbedBuilder()
                        .setColor('#f1c40f')
                        .setTitle('⭐ Give Your Feedback')
                        .setDescription(`Hi <@${ticketData.discordUserId}>,\nYour transaction is completed successfully! Please share your experience to build community trust.\n\n📝 **Write a review message below**\n📸 **Upload a payment screenshot**\n\nWhen you are done, click the **Confirm** button to publish your review.`);

                    const fbBtn = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`confirm_feedback_${ticketData.discordUserId}`).setLabel('✅ Confirm & Publish').setStyle(ButtonStyle.Success)
                    );

                    await feedbackChannel.send({ content: `<@${ticketData.discordUserId}>`, embeds: [fbEmbed], components: [fbBtn] });
                } catch (e) { console.error("Feedback room error:", e); }
            }

            setTimeout(() => { interaction.channel.delete().catch(console.error); }, 5000);

        } catch (error) { 
            console.error("Error Closing Ticket: ", error); 
        }
    }
});

// ==========================================
// 🏆 AUTO-UPDATE LEADERBOARD ENGINES
// ==========================================

async function updateWeeklyLeaderboard(guild) {
    if (!guild) return;
    try {
        const channel = guild.channels.cache.find(c => c.name === '📈・weekly-ledger' || c.name.includes('weekly-ledger'));
        if (!channel) return; 

        const snapshot = await db.collection('p2p_tickets').where('status', '==', 'Completed').get();
        const now = new Date();
        const userVolumes = {};

        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.closedAt && typeof data.closedAt.toDate === 'function') {
                const tradeDate = data.closedAt.toDate();
                const diffTime = Math.abs(now - tradeDate);
                const diffDays = diffTime / (1000 * 60 * 60 * 24);

                if (diffDays <= 7) { 
                    const tag = data.discordUserId ? `<@${data.discordUserId}>` : data.username;
                    const amount = data.amountUsd || 0;
                    userVolumes[tag] = (userVolumes[tag] || 0) + amount;
                }
            }
        });

        const top10 = Object.keys(userVolumes)
            .map(tag => ({ tag, volume: userVolumes[tag] }))
            .sort((a, b) => b.volume - a.volume)
            .slice(0, 10);

        let description = 'These are the Top 10 Highest Volume P2P Traders of the last 7 days:\n\n';
        if (top10.length === 0) {
            description += '*No completed trades found for this week yet.*';
        } else {
            const medals = ['🥇', '🥈', '🥉', '🏅', '🏅', '🎖️', '🎖️', '🎖️', '🎖️', '🎖️'];
            top10.forEach((trader, index) => {
                description += `${medals[index]} **${index + 1}.** ${trader.tag} ━━ **$${trader.volume.toLocaleString()}**\n`;
            });
        }

        const embed = new EmbedBuilder()
            .setColor('#f1c40f')
            .setTitle('🏆 Live Weekly Top Traders')
            .setDescription(description)
            .setTimestamp()
            .setFooter({ text: 'Updates Automatically | Professor Network', iconURL: client.user.displayAvatarURL() });

        const messages = await channel.messages.fetch({ limit: 10 });
        const botMsg = messages.find(m => m.author.id === client.user.id);

        if (botMsg) {
            await botMsg.edit({ embeds: [embed], components: [] });
        } else {
            await channel.send({ embeds: [embed] });
        }
    } catch (error) {
        console.error("Auto Leaderboard Update Error:", error);
    }
}

// 🔥 NAYA: HEIST POINTS CALCULATION & LEVEL SYSTEM
async function updateUserHeistPoints(userId, guild, username) {
    try {
        const snapshot = await db.collection('p2p_tickets')
            .where('discordUserId', '==', userId)
            .where('status', '==', 'Completed')
            .get();

        let totalVolume = 0;
        snapshot.forEach(doc => totalVolume += (doc.data().amountUsd || 0));

        // 10 Points per $100 traded
        const points = Math.floor(totalVolume / 10);

        const LEVELS = [
            { name: '👑 Level 5 — Syndicate', minPoints: 5000 },
            { name: '💎 Level 4 — Elite', minPoints: 1500 },
            { name: '🥇 Level 3 — Insider', minPoints: 500 },
            { name: '🥈 Level 2 — Operator', minPoints: 100 },
            { name: '🥉 Level 1 — Recruit', minPoints: 0 }
        ];

        let targetLevel = LEVELS.find(l => points >= l.minPoints);
        if(!targetLevel) targetLevel = LEVELS[4]; // Default to Recruit

        await db.collection('user_stats').doc(userId).set({
            discordId: userId,
            username: username,
            totalVolume: totalVolume,
            heistPoints: points,
            level: targetLevel.name,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        const member = await guild.members.fetch(userId).catch(()=>null);
        if (member) {
            for (const lvl of LEVELS) {
                let role = guild.roles.cache.find(r => r.name === lvl.name);
                if (!role) {
                    role = await guild.roles.create({ name: lvl.name, color: '#e74c3c' });
                }
                
                if (lvl.name === targetLevel.name) {
                    if (!member.roles.cache.has(role.id)) {
                        await member.roles.add(role);
                        
                        // 🔥 NAYA UPDATE: Send to specific 🎀・level-updates channel with @everyone and User tag
                        const lvlEmbed = new EmbedBuilder()
                            .setColor('#e74c3c')
                            .setTitle('💰 NEW RANK UNLOCKED!')
                            .setDescription(`Congratulations <@${userId}>! You've successfully reached **${targetLevel.name}** with **${points} Heist Points**.\n\nEnjoy your new perks and keep trading to reach the top!`)
                            .setFooter({ text: 'Professor Network - Auto Rank System', iconURL: client.user.displayAvatarURL() });
                        
                        // Check if channel exists, if not, create it automatically
                        let levelChannel = guild.channels.cache.find(c => c.name === '🎀・level-updates' || c.name.includes('level-updates'));
                        
                        if (!levelChannel) {
                            levelChannel = await guild.channels.create({
                                name: '🎀・level-updates',
                                type: ChannelType.GuildText,
                                permissionOverwrites: [
                                    { id: guild.id, deny: [PermissionsBitField.Flags.SendMessages], allow: [PermissionsBitField.Flags.ViewChannel] },
                                    { id: client.user.id, allow: [PermissionsBitField.Flags.SendMessages] }
                                ]
                            });
                        }

                        // Send message with @everyone and User ping
                        await levelChannel.send({ 
                            content: `🔔 **Level Up Alert!** | @everyone | <@${userId}>`, 
                            embeds: [lvlEmbed] 
                        });
                    } // <--- ⚠️ YAHAN WO BRACKET MISSING THA JO AB FIX HO GAYA HAI
                } else {
                    if (member.roles.cache.has(role.id)) {
                        await member.roles.remove(role);
                    }
                }
            }
        }
        
        updateHeistLeaderboard(guild);

    } catch(e) { console.error("Heist Points Update Error:", e); }
}

// 🔥 NAYA: HEIST LEADERBOARD SYSTEM
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
            const medals = ['🥇', '🥈', '🥉', '🏅', '🏅', '🎖️', '🎖️', '🎖️', '🎖️', '🎖️'];
            const medal = medals[i-1] || '🎖️';
            // Extracts only the Rank name (e.g., "Recruit" from "Level 1 — Recruit")
            const rankName = data.level ? data.level.split('—')[1].trim() : 'Recruit';
            
            desc += `${medal} **${i}.** <@${data.discordId}> — **${data.heistPoints} Pts** | Rank: ${rankName} | Vol: $${data.totalVolume.toLocaleString()}\n`;
            i++;
        });

        const embed = new EmbedBuilder()
            .setColor('#e74c3c')
            .setTitle('💰 THE VAULT | HEIST POINTS LEADERBOARD')
            .setDescription(desc)
            .setTimestamp()
            .setFooter({ text: 'Updates Automatically | Professor Network', iconURL: client.user.displayAvatarURL() });

        const messages = await channel.messages.fetch({ limit: 10 });
        const botMsg = messages.find(m => m.author.id === client.user.id);
        if (botMsg) await botMsg.edit({ embeds: [embed] });
        else await channel.send({ embeds: [embed] });

    } catch (e) { console.error("Heist Leaderboard Error:", e); }
}

async function approveUserKYC(userId, guild) {
    let verifiedRole = guild.roles.cache.find(r => r.name === 'Vault Verified');
    if (!verifiedRole) { 
        verifiedRole = await guild.roles.create({ name: 'Vault Verified', color: '#2ecc71' }); 
    }
    
    try {
        const member = await guild.members.fetch(userId);
        
        await member.roles.add(verifiedRole);

        await db.collection('users_kyc').doc(userId).update({ status: 'Approved' }).catch(()=>{});
        globalLastUpdate = Date.now(); 
        
        await member.send('🏦 **Professor Network:** Congratulations! Your Advanced KYC has been approved. You have received the **Vault Verified** tag.').catch(() => {});
    } catch (e) { 
        console.log("External KYC approve error", e); 
    }
}

// ==========================================
// 🌐 WEB DASHBOARD (EXPRESS SERVER)
// ==========================================
const app = express();

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cors());

app.use(session({
    secret: 'professor-vault-secret-key-2026',
    resave: true, 
    saveUninitialized: true, 
    cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

const requireLogin = (req, res, next) => {
    if (req.session.loggedIn) return next();
    res.redirect('/login');
};

app.get('/login', (req, res) => {
    if (req.session.loggedIn) return res.redirect('/');
    res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const authDoc = await db.collection('settings').doc('admin_auth').get();
        let validUser = 'professor', validPass = 'heist2026';
        
        if (authDoc.exists) {
            validUser = authDoc.data().username;
            validPass = authDoc.data().password;
        } else {
            await db.collection('settings').doc('admin_auth').set({ username: validUser, password: validPass });
        }

        if (username === validUser && password === validPass) {
            req.session.loggedIn = true;
            res.redirect('/');
        } else {
            res.render('login', { error: 'Access Denied. Incorrect Credentials.' });
        }
    } catch (error) { 
        res.render('login', { error: 'Database Connection Error. Please verify network.' }); 
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

app.post('/update-credentials', requireLogin, async (req, res) => {
    const { new_username, new_password } = req.body;
    if (new_username && new_password) {
        await db.collection('settings').doc('admin_auth').set({ username: new_username, password: new_password });
        req.session.destroy();
        res.redirect('/login');
    } else { res.redirect('/'); }
});

app.get('/export-ledger', requireLogin, async (req, res) => {
    try {
        const snapshot = await db.collection('p2p_tickets').where('status', '==', 'Completed').get();
        let csv = 'Date,User,Action,Method,Amount(USD),Closed By\n';
        
        snapshot.forEach(doc => {
            const d = doc.data();
            const date = (d.closedAt && typeof d.closedAt.toDate === 'function') ? d.closedAt.toDate().toLocaleString() : 'N/A';
            csv += `"${date}","${d.username}","${d.tradeType}","${d.networkOrMethod}","${d.amountUsd}","${d.closedBy || 'Admin'}"\n`;
        });
        
        res.header('Content-Type', 'text/csv');
        res.attachment('The_Vault_Ledger.csv');
        res.send(csv);
    } catch(e) { 
        res.send("Export Error"); 
    }
});

const GUILD_ID = '1456297708892586057';

app.post('/api/kyc-approve', requireLogin, async (req, res) => {
    const { userId } = req.body;
    try {
        const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
        if (!guild) { 
            return res.json({ success: false, error: "Discord server connection lost. Check Guild ID." }); 
        }
        await approveUserKYC(userId, guild);
        res.json({ success: true });
    } catch (e) { 
        res.json({ success: false, error: e.message }); 
    }
});

app.post('/api/kyc-reject', requireLogin, async (req, res) => {
    const { userId } = req.body;
    try {
        await db.collection('users_kyc').doc(userId).update({ status: 'Rejected' });
        globalLastUpdate = Date.now(); 
        res.json({ success: true });
    } catch (e) { 
        res.json({ success: false, error: e.message }); 
    }
});

app.post('/update-price', requireLogin, async (req, res) => {
    const { buyPrice, sellPrice } = req.body; 
    try {
        const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
        if (!guild) return res.send(`<script>alert("❌ Error: Discord server not found. Check GUILD_ID."); window.location.href="/";</script>`);

        let priceChannel = guild.channels.cache.find(c => c.name === '🚨daily-price-update');
        if (!priceChannel) return res.send(`<script>alert("❌ Error: Channel #🚨daily-price-update not found."); window.location.href="/";</script>`);

        const priceEmbed = new EmbedBuilder()
            .setColor('#f1c40f') 
            .setTitle('📈 USDT Market Price Update')
            .setDescription('**The Vault** has updated the real-time P2P exchange rates. Current market prices are active immediately.')
            .addFields(
                { name: '🟢 BUY PRICE', value: `\`\`\`yaml\n₹ ${buyPrice}\n\`\`\``, inline: true },
                { name: '🔴 SELL PRICE', value: `\`\`\`yaml\n₹ ${sellPrice}\n\`\`\``, inline: true }
            )
            .setTimestamp().setFooter({ text: 'Professor Network - Market Sync', iconURL: client.user.displayAvatarURL() });

        await priceChannel.send({ content: `🔔 **Market Alert** | @everyone`, embeds: [priceEmbed] });
        res.send(`<script>alert("✅ Market Price Broadcasted Successfully to Discord!"); window.location.href="/";</script>`);
    } catch (error) {
        res.send(`<script>alert("❌ Error: ${error.message}"); window.location.href="/";</script>`);
    }
});

app.get('/api/check-updates', requireLogin, (req, res) => {
    res.json({ timestamp: globalLastUpdate });
});

app.get('/', requireLogin, async (req, res) => {
    try {
        const guild = client.guilds.cache.get(GUILD_ID); 
        const liveMembers = guild ? guild.memberCount : 0;
        
        const snapshot = await db.collection('p2p_tickets').where('status', '==', 'Completed').get();
        const pendingTicketsSnap = await db.collection('p2p_tickets').where('status', '==', 'Open').get();
        
        const pendingKycSnap = await db.collection('users_kyc').where('status', '==', 'Pending').get();
        const pendingKycList = [];
        pendingKycSnap.forEach(doc => { 
            pendingKycList.push(doc.data()); 
        });

        let dailyVol = 0, weeklyVol = 0, monthlyVol = 0;
        let buyVol = 0, sellVol = 0;
        const now = new Date();
        const userVolumes = {}; 
        const allCompleted = [];
        const monthWiseData = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; 
        const calendarData = {}; 

        snapshot.forEach(doc => {
            const data = doc.data();
            const amount = data.amountUsd || 0;
            const username = data.username || 'Unknown';
            const type = data.tradeType || 'Unknown';
            
            allCompleted.push(data);
            if (type === 'Buy') buyVol += amount;
            if (type === 'Sell') sellVol += amount;

            if (userVolumes[username]) { 
                userVolumes[username] += amount; 
            } else { 
                userVolumes[username] = amount; 
            }

            if (data.closedAt && typeof data.closedAt.toDate === 'function') {
                const tradeDate = data.closedAt.toDate();
                monthWiseData[tradeDate.getMonth()] += amount;
                
                const year = tradeDate.getFullYear();
                const month = String(tradeDate.getMonth() + 1).padStart(2, '0');
                const day = String(tradeDate.getDate()).padStart(2, '0');
                const dateKey = `${year}-${month}-${day}`;
                calendarData[dateKey] = (calendarData[dateKey] || 0) + amount;

                const diffTime = Math.abs(now - tradeDate);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
                
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
        const recentFeed = allCompleted.slice(0, 10); 
        
        const topTraders = Object.keys(userVolumes)
            .map(username => ({ username, totalVolume: userVolumes[username] }))
            .sort((a, b) => b.totalVolume - a.totalVolume)
            .slice(0, 5);

        res.render('dashboard', { 
            liveMembers, dailyVol, weeklyVol, monthlyVol, topTraders,
            pendingTickets: pendingTicketsSnap.size, pendingKyc: pendingKycSnap.size,
            pendingKycList, buyVol, sellVol, recentFeed,
            monthWiseData: JSON.stringify(monthWiseData), calendarData: JSON.stringify(calendarData)
        });
    } catch (error) { 
        res.send("Dashboard Error: " + error.message); 
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`📊 Admin Vault Dashboard is LIVE on Port ${PORT}`); });

client.login(process.env.DISCORD_TOKEN);