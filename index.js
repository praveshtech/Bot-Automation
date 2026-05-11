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
    ChannelType
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

// 🔥 NAYA UPDATE: Global Smart Tracker for Dashboard Refresh (0 Firebase Reads)
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

    // 🔥 Background loop: Har 1 ghante (3600000 ms) me sabhi servers ka leaderboard refresh karega
    setInterval(() => {
        client.guilds.cache.forEach(guild => {
            updateWeeklyLeaderboard(guild);
        });
    }, 60 * 60 * 1000);
});

// ==========================================
// 🛠️ DISCORD COMMANDS (Admin Setup)
// ==========================================
client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (message.content === '!p2p' && message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        const setupEmbed = new EmbedBuilder().setColor('#ff0000').setTitle('🏦 Exchange Desk (P2P)').setDescription('Welcome to the Professor Network.\n\nOnly verified members can start a transaction. Click below to begin.').setFooter({ text: 'Automated by Bot Automation' });
        const startButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('start_p2p_ticket').setLabel('Start Transaction').setStyle(ButtonStyle.Danger).setEmoji('💸'));
        await message.channel.send({ embeds: [setupEmbed], components: [startButton] });
        await message.delete();
    }

    if (message.content === '!setupkyc' && message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        const kycEmbed = new EmbedBuilder().setColor('#2b2d31').setTitle('🛡️ Network KYC Verification').setDescription('To maintain the highest security and anonymity, all members must complete KYC before trading.\n\nClick the button below to submit your details securely.').setFooter({ text: 'Data is encrypted and stored securely.' });
        const kycButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('start_kyc_form').setLabel('Start KYC').setStyle(ButtonStyle.Primary).setEmoji('📝'));
        await message.channel.send({ embeds: [kycEmbed], components: [kycButton] });
        await message.delete();
    }

    if (message.content === '!setupdashboard' && message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        const dashEmbed = new EmbedBuilder()
            .setColor('#2b2d31')
            .setTitle('🏦 THE VAULT | EXECUTIVE DASHBOARD')
            .setDescription('**[ 🔴 SYSTEM STATUS: STANDBY ]**\n\nClick the **Sync Network Data** button below to securely fetch the latest real-time analytics from the central database.')
            .setFooter({ text: 'Professor Network - Secure Terminal' });
            
        const refreshBtn = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('refresh_dashboard').setLabel('🔄 Sync Network Data').setStyle(ButtonStyle.Primary));
        
        await message.channel.send({ embeds: [dashEmbed], components: [refreshBtn] });
        await message.delete();
    }

    // --- 🏆 WEEKLY LEADERBOARD SETUP (NO BUTTONS) ---
    if (message.content === '!setupleaderboard' && message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        let leaderboardChannel = message.guild.channels.cache.find(c => c.name === 'top-trader-this-week');
        
        if (!leaderboardChannel) {
            leaderboardChannel = await message.guild.channels.create({ 
                name: 'top-trader-this-week', 
                type: ChannelType.GuildText, 
                permissionOverwrites: [
                    { id: message.guild.id, deny: [PermissionsBitField.Flags.SendMessages], allow: [PermissionsBitField.Flags.ViewChannel] },
                    { id: client.user.id, allow: [PermissionsBitField.Flags.SendMessages] }
                ] 
            });
        }

        await message.reply({ content: `✅ Leaderboard setup in ${leaderboardChannel}. It will auto-update!`, ephemeral: true });
        await message.delete();
        
        // Setup hote hi pehli baar list generate kar do
        updateWeeklyLeaderboard(message.guild);
    }
});

// ==========================================
// 🖱️ INTERACTION LOGIC (Buttons, Dropdowns, Forms)
// ==========================================
client.on('interactionCreate', async interaction => {

    // --- 📊 0. DASHBOARD SYNC (REFRESH BUTTON) ---
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
                if (userVolumes[userTag]) { userVolumes[userTag] += amount; } 
                else { userVolumes[userTag] = amount; }

                if (data.closedAt && typeof data.closedAt.toDate === 'function') {
                    const tradeDate = data.closedAt.toDate();
                    const diffTime = Math.abs(now - tradeDate);
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
                    
                    if (diffDays <= 1) dailyVol += amount;
                    if (diffDays <= 7) weeklyVol += amount;
                    if (diffDays <= 30) monthlyVol += amount;
                }
            });

            const topTraders = Object.keys(userVolumes)
                .map(tag => ({ tag, totalVolume: userVolumes[tag] }))
                .sort((a, b) => b.totalVolume - a.totalVolume)
                .slice(0, 5);

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
                .setTimestamp()
                .setFooter({ text: 'Professor Network - Secure Terminal', iconURL: client.user.displayAvatarURL() });

            await interaction.editReply({ embeds: [updatedDashEmbed] });

        } catch (error) {
            console.error("Dashboard Sync Error:", error);
            await interaction.followUp({ content: '❌ Data fetch karne mein error aaya!', ephemeral: true });
        }
    }
    
    // --- 🛡️ 1. KYC SYSTEM ---
    if (interaction.isButton() && interaction.customId === 'start_kyc_form') {
        const kycModal = new ModalBuilder().setCustomId('submit_kyc_modal').setTitle('🛡️ KYC Verification Form');
        const realName = new TextInputBuilder().setCustomId('kyc_name').setLabel('Full Name / Alias').setStyle(TextInputStyle.Short).setRequired(true);
        const discordContactField = new TextInputBuilder().setCustomId('kyc_discord_contact').setLabel('Discord ID / Name').setStyle(TextInputStyle.Short).setRequired(true);
        const paymentInfoField = new TextInputBuilder().setCustomId('kyc_payment').setLabel('Default Payment Info (UPI/Wallet)').setStyle(TextInputStyle.Paragraph).setRequired(true);
        
        kycModal.addComponents(
            new ActionRowBuilder().addComponents(realName), 
            new ActionRowBuilder().addComponents(discordContactField), 
            new ActionRowBuilder().addComponents(paymentInfoField)
        );
        
        await interaction.showModal(kycModal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'submit_kyc_modal') {
        await interaction.deferReply({ ephemeral: true });

        try {
            const existingKyc = await db.collection('users_kyc').doc(interaction.user.id).get();
            if (existingKyc.exists) {
                const status = existingKyc.data().status;
                if (status === 'Pending') {
                    return interaction.editReply({ content: `⚠️ **Action Denied:** You have already submitted a KYC form. Your current status is: **Pending**.\n\nPlease wait for the Admin to review it.` });
                }
                if (status === 'Approved') {
                    const hasVerifiedRole = interaction.member.roles.cache.some(role => role.name === 'Verified');
                    if (hasVerifiedRole) {
                        return interaction.editReply({ content: `✅ **Action Denied:** Your KYC is already **Approved**. You can go ahead and start a P2P transaction!` });
                    } else {
                        await db.collection('users_kyc').doc(interaction.user.id).delete();
                    }
                }
            }

            const name = interaction.fields.getTextInputValue('kyc_name');
            const discordContactVal = interaction.fields.getTextInputValue('kyc_discord_contact');
            const paymentDetails = interaction.fields.getTextInputValue('kyc_payment'); 
            
            let reviewChannel = interaction.guild.channels.cache.find(c => c.name === 'kyc-requests');
            if (!reviewChannel) { 
                reviewChannel = await interaction.guild.channels.create({ name: 'kyc-requests', type: ChannelType.GuildText, permissionOverwrites: [{ id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }] }); 
            }
            
            const adminEmbed = new EmbedBuilder()
                .setColor('#e67e22')
                .setTitle('🚨 New KYC Request')
                .addFields(
                    { name: 'User', value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: true }, 
                    { name: 'Name/Alias', value: name, inline: true }, 
                    { name: 'Discord ID/Name', value: discordContactVal, inline: true }, 
                    { name: 'Payment Info', value: paymentDetails, inline: false }
                );
                
            const actionButtons = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`approve_kyc_${interaction.user.id}`).setLabel('Approve').setStyle(ButtonStyle.Success), 
                new ButtonBuilder().setCustomId(`reject_kyc_${interaction.user.id}`).setLabel('Reject').setStyle(ButtonStyle.Danger)
            );

            await Promise.all([
                reviewChannel.send({ embeds: [adminEmbed], components: [actionButtons] }),
                db.collection('users_kyc').doc(interaction.user.id).set({ 
                    discordId: interaction.user.id, 
                    username: interaction.user.username, 
                    name: name, 
                    discordContact: discordContactVal, 
                    paymentInfo: paymentDetails, 
                    status: 'Pending', 
                    createdAt: admin.firestore.FieldValue.serverTimestamp() 
                })
            ]);

            globalLastUpdate = Date.now(); 
            await interaction.editReply({ content: '✅ Your KYC details have been submitted securely. Please wait for approval.' });

        } catch (error) {
            console.error("KYC Submit Error:", error);
            await interaction.editReply({ content: '❌ Something went wrong while saving your data. Please contact support.' });
        }
    }

    if (interaction.isButton() && interaction.customId.startsWith('approve_kyc_')) {
        const userId = interaction.customId.replace('approve_kyc_', '');
        await interaction.deferUpdate(); 

        await approveUserKYC(userId, interaction.guild);
        
        const oldEmbed = interaction.message.embeds[0];
        const updatedEmbed = EmbedBuilder.from(oldEmbed).setColor('#2ecc71').setTitle('✅ KYC Approved');
        
        await interaction.editReply({ embeds: [updatedEmbed], components: [] });
        await interaction.followUp({ content: `✅ Successfully verified <@${userId}>!`, ephemeral: true });
    }

    if (interaction.isButton() && interaction.customId.startsWith('reject_kyc_')) {
        const userId = interaction.customId.replace('reject_kyc_', '');
        await interaction.deferUpdate();

        await db.collection('users_kyc').doc(userId).update({ status: 'Rejected' });
        
        globalLastUpdate = Date.now(); 

        const oldEmbed = interaction.message.embeds[0];
        const updatedEmbed = EmbedBuilder.from(oldEmbed).setColor('#e74c3c').setTitle('❌ KYC Rejected');
        
        await interaction.editReply({ embeds: [updatedEmbed], components: [] });
        await interaction.followUp({ content: `❌ KYC Rejected for <@${userId}>.`, ephemeral: true });
    }

    // --- 💸 2. P2P TICKET SYSTEM ---
    if (interaction.isButton() && interaction.customId === 'start_p2p_ticket') {
        const hasRole = interaction.member.roles.cache.some(role => role.name === 'Verified');
        if (!hasRole && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: '⚠️ **Access Denied:** You must complete KYC to start a transaction. Please go to the Verification channel.', ephemeral: true });
        }
        userSelections.set(interaction.user.id, { type: null, step2: null, step3: null });
        const typeDropdown = new StringSelectMenuBuilder().setCustomId('dropdown_type').setPlaceholder('Select Action: Buy or Sell').addOptions([{ label: 'Buy Crypto (Pay INR)', value: 'Buy', emoji: '🟢' }, { label: 'Sell Crypto (Get INR)', value: 'Sell', emoji: '🔴' }]);
        const row1 = new ActionRowBuilder().addComponents(typeDropdown);
        await interaction.reply({ content: '🏦 **Professor Network:** Step 1 - Do you want to Buy or Sell Crypto?', components: [row1], ephemeral: true });
    }

    // 🔥 Dynamic Dropdown Logic
    if (interaction.isStringSelectMenu()) {
        const userState = userSelections.get(interaction.user.id) || { type: null, step2: null, step3: null };
        
        if (interaction.customId === 'dropdown_type') {
            userState.type = interaction.values[0];
            userState.step2 = null;
            userState.step3 = null;
            userSelections.set(interaction.user.id, userState);
            const typeDropdown = new StringSelectMenuBuilder().setCustomId('dropdown_type').addOptions([{ label: 'Buy Crypto (Pay INR)', value: 'Buy', emoji: '🟢', default: userState.type === 'Buy' }, { label: 'Sell Crypto (Get INR)', value: 'Sell', emoji: '🔴', default: userState.type === 'Sell' }]);
            const step2Dropdown = new StringSelectMenuBuilder().setCustomId('dropdown_step2');
            if (userState.type === 'Sell') {
                step2Dropdown.setPlaceholder('Select Crypto Network').addOptions([{ label: 'TRC20 (Tron)', value: 'TRC20', emoji: '🔗' }, { label: 'ERC20 (Ethereum)', value: 'ERC20', emoji: '💎' }, { label: 'BEP20 (Binance)', value: 'BEP20', emoji: '🟡' }, { label: 'BTC (Bitcoin)', value: 'BTC', emoji: '🪙' }]);
            } else {
                step2Dropdown.setPlaceholder('Choose Payment Method').addOptions([{ label: 'UPI', value: 'UPI', emoji: '📱' }, { label: 'IMPS/Bank Transfer', value: 'IMPS', emoji: '🏦' }, { label: 'Cash Deposit (CDM)', value: 'CDM', emoji: '🏧' }]);
            }
            const row1 = new ActionRowBuilder().addComponents(typeDropdown);
            const row2 = new ActionRowBuilder().addComponents(step2Dropdown);
            await interaction.update({ content: `🏦 **Professor Network:** Step 2 - Select your ${userState.type === 'Sell' ? 'Network' : 'Payment Method'}.`, components: [row1, row2] });
        }
        
        if (interaction.customId === 'dropdown_step2' || interaction.customId === 'dropdown_step3') {
            if (interaction.customId === 'dropdown_step2') {
                userState.step2 = interaction.values[0];
                userState.step3 = null;
            } else {
                userState.step3 = interaction.values[0];
            }
            userSelections.set(interaction.user.id, userState);
            
            const typeDropdown = new StringSelectMenuBuilder().setCustomId('dropdown_type').addOptions([{ label: 'Buy Crypto (Pay INR)', value: 'Buy', emoji: '🟢', default: userState.type === 'Buy' }, { label: 'Sell Crypto (Get INR)', value: 'Sell', emoji: '🔴', default: userState.type === 'Sell' }]);
            const step2Dropdown = new StringSelectMenuBuilder().setCustomId('dropdown_step2');
            if (userState.type === 'Sell') {
                step2Dropdown.addOptions([{ label: 'TRC20 (Tron)', value: 'TRC20', emoji: '🔗', default: userState.step2 === 'TRC20' }, { label: 'ERC20 (Ethereum)', value: 'ERC20', emoji: '💎', default: userState.step2 === 'ERC20' }, { label: 'BEP20 (Binance)', value: 'BEP20', emoji: '🟡', default: userState.step2 === 'BEP20' }, { label: 'BTC (Bitcoin)', value: 'BTC', emoji: '🪙', default: userState.step2 === 'BTC' }]);
            } else {
                step2Dropdown.addOptions([{ label: 'UPI', value: 'UPI', emoji: '📱', default: userState.step2 === 'UPI' }, { label: 'IMPS/Bank Transfer', value: 'IMPS', emoji: '🏦', default: userState.step2 === 'IMPS' }, { label: 'Cash Deposit (CDM)', value: 'CDM', emoji: '🏧', default: userState.step2 === 'CDM' }]);
            }
            
            const row1 = new ActionRowBuilder().addComponents(typeDropdown);
            const row2 = new ActionRowBuilder().addComponents(step2Dropdown);
            const components = [row1, row2];

            if (userState.type === 'Sell') {
                const step3Dropdown = new StringSelectMenuBuilder().setCustomId('dropdown_step3').setPlaceholder('Select Receiving Method');
                step3Dropdown.addOptions([
                    { label: 'IMPS (Bank Transfer)', value: 'IMPS', emoji: '🏦', default: userState.step3 === 'IMPS' },
                    { label: 'CDM (Cash Deposit)', value: 'CDM', emoji: '🏧', default: userState.step3 === 'CDM' },
                    { label: 'CCW', value: 'CCW', emoji: '💳', default: userState.step3 === 'CCW' }
                ]);
                components.push(new ActionRowBuilder().addComponents(step3Dropdown));

                if (userState.step3) {
                    const nextButton = new ButtonBuilder().setCustomId('proceed_to_amount').setLabel('Next (Enter Details)').setStyle(ButtonStyle.Success);
                    components.push(new ActionRowBuilder().addComponents(nextButton));
                    await interaction.update({ content: '🏦 **Professor Network:** Step 4 - Click Next to enter Amount.', components });
                } else {
                    await interaction.update({ content: '🏦 **Professor Network:** Step 3 - Select how you want to receive INR.', components });
                }
            } else {
                const nextButton = new ButtonBuilder().setCustomId('proceed_to_amount').setLabel('Next (Enter Details)').setStyle(ButtonStyle.Success);
                components.push(new ActionRowBuilder().addComponents(nextButton));
                await interaction.update({ content: '🏦 **Professor Network:** Step 3 - Click Next to enter Amount.', components });
            }
        }
    }

    // Dynamic Labels for Forms
    if (interaction.isButton() && interaction.customId === 'proceed_to_amount') {
        const userState = userSelections.get(interaction.user.id);
        const p2pModal = new ModalBuilder().setCustomId('final_p2p_modal').setTitle(`🏦 Transaction: ${userState.type} Crypto`);
        const amountInput = new TextInputBuilder().setCustomId('trade_amount').setLabel('Amount in USD ($)').setPlaceholder('e.g. 5000').setStyle(TextInputStyle.Short).setRequired(true);
        let userReceivingDetails;
        
        if (userState.type === 'Sell') {
            let dynamicLabel = `Your ${userState.step3 || 'Bank'} details (To receive INR)`;
            let dynamicPlaceholder = 'Enter your account info here';
            
            if (userState.step3 === 'IMPS') dynamicPlaceholder = 'Bank Name, Account No, IFSC...';
            if (userState.step3 === 'CDM') dynamicPlaceholder = 'CDM Account No, Branch, Name...';
            if (userState.step3 === 'CCW') dynamicPlaceholder = 'Enter your CCW details here...';

            userReceivingDetails = new TextInputBuilder()
                .setCustomId('user_receiving_details')
                .setLabel(dynamicLabel)
                .setPlaceholder(dynamicPlaceholder)
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);
        } else {
            userReceivingDetails = new TextInputBuilder().setCustomId('user_receiving_details').setLabel('Your Crypto Wallet Address (To receive)').setPlaceholder('Enter your wallet address here').setStyle(TextInputStyle.Short).setRequired(true);
        }
        
        const row1 = new ActionRowBuilder().addComponents(amountInput);
        const row2 = new ActionRowBuilder().addComponents(userReceivingDetails);
        p2pModal.addComponents(row1, row2);
        await interaction.showModal(p2pModal);
    }

    // --- 🔒 3. PRIVATE CHANNEL CREATION ---
    if (interaction.isModalSubmit() && interaction.customId === 'final_p2p_modal') {
        const userState = userSelections.get(interaction.user.id);
        const tradeAmount = interaction.fields.getTextInputValue('trade_amount');
        const userDetails = interaction.fields.getTextInputValue('user_receiving_details');
        await interaction.reply({ content: '🏦 Creating your secure P2P room...', ephemeral: true });

        const palermoRole = interaction.guild.roles.cache.find(role => role.name === 'Palermo');
        const verifiedRole = interaction.guild.roles.cache.find(role => role.name === 'Verified');
        
        const channelPermissions = [
            { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }, 
            { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] } 
        ];
        if (verifiedRole) channelPermissions.push({ id: verifiedRole.id, deny: [PermissionsBitField.Flags.ViewChannel] });
        if (palermoRole) channelPermissions.push({ id: palermoRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageMessages] });

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

        try {
            await db.collection('p2p_tickets').doc(ticketChannel.id).set({ 
                discordUserId: interaction.user.id, 
                username: interaction.user.username, 
                tradeType: userState.type, 
                networkOrMethod: userState.type === 'Sell' ? `${userState.step2} / ${userState.step3}` : userState.step2, 
                amountUsd: Number(tradeAmount), 
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
            `> ${userState.type} Crypto\n` +
            `**2. How much amount ($)?**\n` +
            `> ${tradeAmount}\n` +
            `**3. Which Method?**\n` +
            `> ${userState.type === 'Sell' ? userState.step2 + ' (Receive via ' + userState.step3 + ')' : userState.step2}\n\n` +
            `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;

        const ticketEmbed = new EmbedBuilder()
            .setColor('#e50914')
            .setAuthor({ name: '🏦 Secure P2P Room', iconURL: client.user.displayAvatarURL() })
            .setDescription(cinematicDescription)
            .setFooter({ text: 'Share your payment screenshot here after successful transfer.', iconURL: client.user.displayAvatarURL() });

        // 🔥 NAYA UPDATE: Cancel Button label changed to be available for Users too
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

    // --- 🔐 4. SECURE REVEAL BUTTON HANDLERS ---
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

    // --- 🏦 5. TICKET CLOSE & LOGGING (Complete OR Cancel) ---
    // 🔥 NAYA UPDATE: Split Permissions for Complete and Cancel buttons
    if (interaction.isButton() && (interaction.customId === 'complete_p2p_ticket' || interaction.customId === 'cancel_p2p_ticket')) {
        const isPalermo = interaction.member.roles.cache.some(role => role.name === 'Palermo');
        const isProfessor = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
        const isAdmin = isProfessor || isPalermo;

        try {
            // Check Database to see who the ticket creator is
            const ticketDoc = await db.collection('p2p_tickets').doc(interaction.channel.id).get();
            if (!ticketDoc.exists) {
                return interaction.reply({ content: '❌ Ticket data not found.', ephemeral: true });
            }
            
            const ticketData = ticketDoc.data();
            const isTicketCreator = interaction.user.id === ticketData.discordUserId;

            // Security Rules
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
            
            // 📢 🔥 PUBLIC TRANSACTION LOG 🔥
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

            // 🔥 Leaderboard Auto-update on successful trade
            if (isSuccess) {
                updateWeeklyLeaderboard(interaction.guild);
            }

            const mainTicketChannel = interaction.guild.channels.cache.find(c => c.name === 'tickets' || c.name === 'exchange-desk');
            if (mainTicketChannel) {
                const fetchedMessages = await mainTicketChannel.messages.fetch({ limit: 10 });
                const botMessages = fetchedMessages.filter(m => m.author.id === client.user.id);
                botMessages.forEach(msg => msg.delete().catch(console.error));
                
                const setupEmbed = new EmbedBuilder().setColor('#ff0000').setTitle('🏦 Exchange Desk (P2P)').setDescription('Welcome to the Professor Network.\n\nOnly verified members can start a transaction. Click below to begin.').setFooter({ text: 'Automated by Professor Network' });
                const startButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('start_p2p_ticket').setLabel('Start Transaction').setStyle(ButtonStyle.Danger).setEmoji('💸'));
                await mainTicketChannel.send({ embeds: [setupEmbed], components: [startButton] });
            }

            setTimeout(() => { interaction.channel.delete().catch(console.error); }, 5000);

        } catch (error) { 
            console.error("Error Closing Ticket: ", error); 
        }
    }
});

// --- 🏆 AUTO-UPDATE LEADERBOARD ENGINE ---
async function updateWeeklyLeaderboard(guild) {
    if (!guild) return;
    try {
        const channel = guild.channels.cache.find(c => c.name === 'top-trader-this-week');
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

async function approveUserKYC(userId, guild) {
    let verifiedRole = guild.roles.cache.find(r => r.name === 'Verified');
    if (!verifiedRole) { verifiedRole = await guild.roles.create({ name: 'Verified', color: '#2ecc71' }); }
    try {
        const member = await guild.members.fetch(userId);
        
        // 1. Give Verified Role
        await member.roles.add(verifiedRole);

        // 🔥 2. NAYA UPDATE: Change User Nickname to add [KYC Verified] tag
        const currentName = member.displayName;
        if (!currentName.includes('Verified✔️')) {
            let newName = ` ${currentName} Verified✔️`;
            // Discord limits nicknames to max 32 characters, so we trim if it's too long
            if (newName.length > 32) newName = newName.substring(0, 32); 
            
            // Note: Bot Server Owner/Admin ka naam change nahi kar sakta, uske liye error catch lagaya hai
            await member.setNickname(newName).catch(err => console.log("Nickname Error (Bot Role Hierarchy):", err.message));
        }

        // 3. Update Database
        await db.collection('users_kyc').doc(userId).update({ status: 'Approved' });
        globalLastUpdate = Date.now(); 
        
        // 4. Send DM
        await member.send('🏦 **Professor Network:** Congratulations! Your KYC has been approved and your profile is now Verified✔️.').catch(() => {});
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

// Session Configuration
app.use(session({
    secret: 'professor-vault-secret-key-2026',
    resave: true, 
    saveUninitialized: true, 
    cookie: { 
        secure: false, 
        maxAge: 7 * 24 * 60 * 60 * 1000 
    }
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
        console.error("Login Error:", error);
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
    } catch(e) { res.send("Export Error"); }
});

const GUILD_ID = '1456297708892586057'; // Ensure this matches your server ID

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
        console.error("KYC Approve API Error:", e);
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
        console.error("KYC Reject API Error:", e);
        res.json({ success: false, error: e.message }); 
    }
});

// ==========================================
// 📈 MARKET PRICE BROADCAST API
// ==========================================
app.post('/update-price', requireLogin, async (req, res) => {
    const { buyPrice, sellPrice } = req.body; 
    
    try {
        const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
        if (!guild) {
            return res.send(`<script>alert("❌ Error: Discord server not found. Check GUILD_ID."); window.location.href="/";</script>`);
        }

        let priceChannel = guild.channels.cache.find(c => c.name === '🚨daily-price-update');
        
        if (!priceChannel) {
            return res.send(`<script>alert("❌ Error: Channel #🚨daily-price-update not found in Discord!"); window.location.href="/";</script>`);
        }

        const priceEmbed = new EmbedBuilder()
            .setColor('#f1c40f') 
            .setTitle('📈 USDT Market Price Update')
            .setDescription('**The Vault** has updated the real-time P2P exchange rates. Current market prices are active immediately.')
            .addFields(
                { name: '🟢 BUY PRICE', value: `\`\`\`yaml\n₹ ${buyPrice}\n\`\`\``, inline: true },
                { name: '🔴 SELL PRICE', value: `\`\`\`yaml\n₹ ${sellPrice}\n\`\`\``, inline: true }
            )
            .setTimestamp()
            .setFooter({ text: 'Professor Network - Market Sync', iconURL: client.user.displayAvatarURL() });

        await priceChannel.send({ content: `🔔 **Market Alert** | @everyone`, embeds: [priceEmbed] });
        
        res.send(`<script>alert("✅ Market Price Broadcasted Successfully to Discord!"); window.location.href="/";</script>`);

    } catch (error) {
        console.error("Price Broadcast Error:", error);
        res.send(`<script>alert("❌ Error: ${error.message}"); window.location.href="/";</script>`);
    }
});

app.get('/api/check-updates', requireLogin, (req, res) => {
    res.json({ timestamp: globalLastUpdate });
});

app.get('/', requireLogin, async (req, res) => {
    try {
        const guild = client.guilds.cache.first(); 
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

            if (userVolumes[username]) { userVolumes[username] += amount; } 
            else { userVolumes[username] = amount; }

            if (data.closedAt && typeof data.closedAt.toDate === 'function') {
                const tradeDate = data.closedAt.toDate();
                
                // --- Monthly Data Calculation ---
                monthWiseData[tradeDate.getMonth()] += amount;
                
                // --- Calendar Data Calculation ---
                const year = tradeDate.getFullYear();
                const month = String(tradeDate.getMonth() + 1).padStart(2, '0');
                const day = String(tradeDate.getDate()).padStart(2, '0');
                const dateKey = `${year}-${month}-${day}`;
                calendarData[dateKey] = (calendarData[dateKey] || 0) + amount;

                // --- Existing Time Logic ---
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
            pendingTickets: pendingTicketsSnap.size,
            pendingKyc: pendingKycSnap.size,
            pendingKycList, 
            buyVol, sellVol, recentFeed,
            monthWiseData: JSON.stringify(monthWiseData),
            calendarData: JSON.stringify(calendarData)
        });
    } catch (error) { 
        console.error("Dashboard Render Error: ", error);
        res.send("Dashboard Error: " + error.message); 
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`📊 Admin Vault Dashboard is LIVE on Port ${PORT}`); });

client.login(process.env.DISCORD_TOKEN);