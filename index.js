require('dotenv').config();
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

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore(); 

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers 
    ]
});

const userSelections = new Map();

client.once('Ready', () => {
    console.log(`✅ BOT ONLINE: Logged in as ${client.user.tag}`);
    console.log(`🔥 FIREBASE: Connected Successfully`);
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
});

// ==========================================
// 🖱️ INTERACTION LOGIC (Buttons, Dropdowns, Forms)
// ==========================================
client.on('interactionCreate', async interaction => {
    
    // --- 🛡️ 1. KYC SYSTEM ---
    if (interaction.isButton() && interaction.customId === 'start_kyc_form') {
        const kycModal = new ModalBuilder().setCustomId('submit_kyc_modal').setTitle('🛡️ KYC Verification Form');
        const realName = new TextInputBuilder().setCustomId('kyc_name').setLabel('Full Name / Alias').setStyle(TextInputStyle.Short).setRequired(true);
        const discordContactField = new TextInputBuilder().setCustomId('kyc_discord_contact').setLabel('Discord ID / Name').setStyle(TextInputStyle.Short).setRequired(true);
        const paymentInfoField = new TextInputBuilder().setCustomId('kyc_payment').setLabel('Default Payment Info (UPI/Wallet)').setStyle(TextInputStyle.Paragraph).setRequired(true);
        
        kycModal.addComponents(new ActionRowBuilder().addComponents(realName), new ActionRowBuilder().addComponents(discordContactField), new ActionRowBuilder().addComponents(paymentInfoField));
        await interaction.showModal(kycModal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'submit_kyc_modal') {
        
        // 1. SABSE PEHLE TURANT REPLY (Taaki laal error na aaye)
        await interaction.reply({ 
            content: '✅ Your KYC details have been successfully submitted! Please wait for verification.', 
            ephemeral: true 
        });

        // 2. DATA NIKALNA (Aapka form jaisa tha bilkul waisa hi hai)
        const name = interaction.fields.getTextInputValue('kyc_name');
        const discordContactVal = interaction.fields.getTextInputValue('kyc_discord_contact');
        const paymentDetails = interaction.fields.getTextInputValue('kyc_payment'); 
        
        // 3. BACKGROUND TASKS (Admin ko alert aur Firebase save)
        try {
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
            await reviewChannel.send({ embeds: [adminEmbed], components: [actionButtons] });

            // Yahi same data aapke firebase me store ho raha hai
            await db.collection('users_kyc').doc(interaction.user.id).set({ 
                discordId: interaction.user.id, 
                username: interaction.user.username, 
                name: name, 
                discordContact: discordContactVal, 
                paymentInfo: paymentDetails, 
                status: 'Pending', 
                createdAt: admin.firestore.FieldValue.serverTimestamp() 
            });
        } catch (error) {
            console.error("KYC Background Task Error: ", error);
        }
    }

    if (interaction.isButton() && interaction.customId.startsWith('approve_kyc_')) {
        const userId = interaction.customId.replace('approve_kyc_', '');
        await approveUserKYC(userId, interaction.guild);
        
        await interaction.reply({ content: `✅ Successfully verified <@${userId}>!` });
        const oldEmbed = interaction.message.embeds[0];
        const updatedEmbed = EmbedBuilder.from(oldEmbed).setColor('#2ecc71').setTitle('✅ KYC Approved');
        await interaction.message.edit({ embeds: [updatedEmbed], components: [] });
    }

    if (interaction.isButton() && interaction.customId.startsWith('reject_kyc_')) {
        const userId = interaction.customId.replace('reject_kyc_', '');
        await db.collection('users_kyc').doc(userId).update({ status: 'Rejected' });
        await interaction.reply({ content: `❌ KYC Rejected for <@${userId}>.` });
        const oldEmbed = interaction.message.embeds[0];
        const updatedEmbed = EmbedBuilder.from(oldEmbed).setColor('#e74c3c').setTitle('❌ KYC Rejected');
        await interaction.message.edit({ embeds: [updatedEmbed], components: [] });
    }

    // --- 💸 2. P2P TICKET SYSTEM ---
    if (interaction.isButton() && interaction.customId === 'start_p2p_ticket') {
        const hasRole = interaction.member.roles.cache.some(role => role.name === 'Verified');
        if (!hasRole && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: '⚠️ **Access Denied:** You must complete KYC to start a transaction. Please go to the Verification channel.', ephemeral: true });
        }
        userSelections.set(interaction.user.id, { type: null, step2: null });
        const typeDropdown = new StringSelectMenuBuilder().setCustomId('dropdown_type').setPlaceholder('Select Action: Buy or Sell').addOptions([{ label: 'Buy Crypto (Pay INR)', value: 'Buy', emoji: '🟢' }, { label: 'Sell Crypto (Get INR)', value: 'Sell', emoji: '🔴' }]);
        const row1 = new ActionRowBuilder().addComponents(typeDropdown);
        await interaction.reply({ content: '🏦 **Professor Network:** Step 1 - Do you want to Buy or Sell Crypto?', components: [row1], ephemeral: true });
    }

    if (interaction.isStringSelectMenu()) {
        const userState = userSelections.get(interaction.user.id) || { type: null, step2: null };
        if (interaction.customId === 'dropdown_type') {
            userState.type = interaction.values[0];
            userState.step2 = null;
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
        if (interaction.customId === 'dropdown_step2') {
            userState.step2 = interaction.values[0];
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
            const nextButton = new ButtonBuilder().setCustomId('proceed_to_amount').setLabel('Next (Enter Details)').setStyle(ButtonStyle.Success);
            const row3 = new ActionRowBuilder().addComponents(nextButton);
            await interaction.update({ content: '🏦 **Professor Network:** Step 3 - Click Next to enter Amount.', components: [row1, row2, row3] });
        }
    }

    if (interaction.isButton() && interaction.customId === 'proceed_to_amount') {
        const userState = userSelections.get(interaction.user.id);
        const p2pModal = new ModalBuilder().setCustomId('final_p2p_modal').setTitle(`🏦 Transaction: ${userState.type} Crypto`);
        const amountInput = new TextInputBuilder().setCustomId('trade_amount').setLabel('Amount in USD ($)').setPlaceholder('e.g. 5000').setStyle(TextInputStyle.Short).setRequired(true);
        let userReceivingDetails;
        if (userState.type === 'Sell') {
            userReceivingDetails = new TextInputBuilder().setCustomId('user_receiving_details').setLabel('Your Bank/UPI details (To receive INR)').setPlaceholder('Enter your account info here').setStyle(TextInputStyle.Paragraph).setRequired(true);
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

        try {
            await db.collection('p2p_tickets').doc(ticketChannel.id).set({ discordUserId: interaction.user.id, username: interaction.user.username, tradeType: userState.type, networkOrMethod: userState.step2, amountUsd: Number(tradeAmount), userReceivingDetails: userDetails, status: 'Open', createdAt: admin.firestore.FieldValue.serverTimestamp() });
        } catch (error) { console.error("Firebase Error: ", error); }

        let adminProvides = ""; let actionDescription = ""; let easyCopyText = ""; 
        if (userState.type === 'Sell') {
            actionDescription = `You are **Selling Crypto**. Please transfer the crypto via **${userState.step2}** to the admin's address below.`;
            let walletAddress = "Waiting for Admin to provide address.";
            if (userState.step2 === 'TRC20') walletAddress = "TABCDEF1234567890YOURTRC20WALLETADDRESS";
            if (userState.step2 === 'ERC20') walletAddress = "0xABCDEF1234567890YOURERC20WALLETADDRESS";
            if (userState.step2 === 'BEP20') walletAddress = "0xBEP20ADDRESSEXAMPLE";
            if (userState.step2 === 'BTC') walletAddress = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
            adminProvides = `**Admin's Crypto Address:**\n\`\`\`${walletAddress}\`\`\``; easyCopyText = walletAddress; 
        } else {
            actionDescription = `You are **Buying Crypto**. Please transfer INR via **${userState.step2}** to the admin's details below.`;
            let paymentDetails = "Waiting for Admin to provide bank details.";
            if (userState.step2 === 'UPI') paymentDetails = "admin@upi";
            if (userState.step2 === 'IMPS') paymentDetails = "Bank: SBI\nAcc: 123456789\nIFSC: SBIN0001234";
            if (userState.step2 === 'CDM') paymentDetails = "Cash Deposit Acc: 9876543210 (HDFC)";
            adminProvides = `**Admin's Bank/Payment Details:**\n\`\`\`${paymentDetails}\`\`\``; easyCopyText = paymentDetails; 
        }

        const ticketEmbed = new EmbedBuilder().setColor('#ff0000').setTitle(`🏦 Secure P2P Room: ${interaction.user.username}`).setDescription(`Welcome, ${interaction.user.toString()}! Below are your transaction details.\n\n${actionDescription}`).addFields({ name: 'Action', value: userState.type, inline: true }, { name: 'Amount', value: `$${tradeAmount}`, inline: true }, { name: 'Method', value: userState.step2, inline: true }, { name: 'Your Provided Details', value: `\`\`\`${userDetails}\`\`\``, inline: false }, { name: '🏦 Transfer Details', value: adminProvides, inline: false }).setFooter({ text: 'Share your payment screenshot here after successful transfer.' });
        const closeButtonRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_p2p_ticket').setLabel('🔒 Close Ticket (Palermo/Admin Only)').setStyle(ButtonStyle.Danger));
        
        await ticketChannel.send({ embeds: [ticketEmbed], components: [closeButtonRow] });
        await ticketChannel.send(`👤 **[ FOR USER ]** Long press below to copy Admin's Transfer Details:`);
        await ticketChannel.send(`**${easyCopyText}**`);
        await ticketChannel.send(`👨‍💼 **[ FOR ADMIN ]** Long press below to copy User's Receiving Details:`);
        await ticketChannel.send(`**${userDetails}**`);
        
        if (palermoRole) await ticketChannel.send(`🔔 <@&${palermoRole.id}> A new transaction ticket has been opened.`).then(msg => setTimeout(() => msg.delete(), 5000));
        await interaction.editReply({ content: `✅ Ticket created successfully! Click here to view: ${ticketChannel}` });
        userSelections.delete(interaction.user.id);
    }

    // --- 🏦 4. TICKET CLOSE & LOGGING ---
    if (interaction.isButton() && interaction.customId === 'close_p2p_ticket') {
        const isPalermo = interaction.member.roles.cache.some(role => role.name === 'Palermo');
        const isProfessor = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
        if (!isProfessor && !isPalermo) return interaction.reply({ content: '❌ **Access Denied:** Only Palermo or Professor can close tickets.', ephemeral: true });

        await interaction.reply({ content: '🔒 Ticket closing in 5 seconds. Saving data to Vault and refreshing panel...' });

        try {
            const ticketDoc = await db.collection('p2p_tickets').doc(interaction.channel.id).get();
            if (ticketDoc.exists) {
                const ticketData = ticketDoc.data();
                
                const member = await interaction.guild.members.fetch(ticketData.discordUserId).catch(() => null);
                if (member) {
                    const receiptEmbed = new EmbedBuilder().setColor('#2ecc71').setTitle('🧾 Transaction Completed').setDescription(`Hello **${ticketData.username}**,\n\nYour P2P transaction of **$${ticketData.amountUsd}** has been successfully closed by Palermo Network.\n\nThank you for trading with us! 🏦`).setFooter({ text: 'Professor Network - Money Heist Automated System' });
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

                const vaultEmbed = new EmbedBuilder().setColor('#f1c40f').setTitle('🏦 Vault Record: Transaction Completed').addFields({ name: '👤 User', value: `${ticketData.username} (<@${ticketData.discordUserId}>)`, inline: true }, { name: '🔒 Closed By', value: `${interaction.user.username} (<@${interaction.user.id}>)`, inline: true }, { name: 'Trade Type', value: ticketData.tradeType, inline: true }, { name: 'Amount', value: `$${ticketData.amountUsd}`, inline: true }, { name: 'Method/Network', value: ticketData.networkOrMethod, inline: true }, { name: 'User Info Provided', value: `\`\`\`${ticketData.userReceivingDetails}\`\`\``, inline: false }).setTimestamp().setFooter({ text: `Ticket ID: ${interaction.channel.id}` });
                await logChannel.send({ embeds: [vaultEmbed] });
            }

            await db.collection('p2p_tickets').doc(interaction.channel.id).update({ status: 'Completed', closedBy: interaction.user.username, closedAt: admin.firestore.FieldValue.serverTimestamp() });

            const mainTicketChannel = interaction.guild.channels.cache.find(c => c.name === 'tickets' || c.name === 'exchange-desk');
            if (mainTicketChannel) {
                const fetchedMessages = await mainTicketChannel.messages.fetch({ limit: 10 });
                const botMessages = fetchedMessages.filter(m => m.author.id === client.user.id);
                botMessages.forEach(msg => msg.delete().catch(console.error));
                
                const setupEmbed = new EmbedBuilder().setColor('#ff0000').setTitle('🏦 Exchange Desk (P2P)').setDescription('Welcome to the Professor Network.\n\nOnly verified members can start a transaction. Click below to begin.').setFooter({ text: 'Automated by Professor Network' });
                const startButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('start_p2p_ticket').setLabel('Start Transaction').setStyle(ButtonStyle.Danger).setEmoji('💸'));
                await mainTicketChannel.send({ embeds: [setupEmbed], components: [startButton] });
            }
        } catch (error) { console.error("Error: ", error); }

        setTimeout(() => { interaction.channel.delete().catch(console.error); }, 5000);
    }

    // --- 📊 5. DISCORD DASHBOARD REFRESH ---
    if (interaction.isButton() && interaction.customId === 'refresh_dashboard') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: '❌ Access Denied. Only The Professor can view the vault stats.', ephemeral: true });
        }
        await interaction.deferUpdate();
        try {
            const liveMembers = interaction.guild.memberCount;
            const snapshot = await db.collection('p2p_tickets').where('status', '==', 'Completed').get();
            
            let dailyVol = 0, weeklyVol = 0, monthlyVol = 0;
            const now = new Date();
            const userVolumes = {}; 

            snapshot.forEach(doc => {
                const data = doc.data();
                const amount = data.amountUsd || 0;
                const userId = data.discordUserId; 
                
                if (userId) {
                    if (userVolumes[userId]) { 
                        userVolumes[userId].volume += amount; 
                    } else { 
                        userVolumes[userId] = { id: userId, volume: amount }; 
                    }
                }

                if (data.closedAt) {
                    const tradeDate = data.closedAt.toDate();
                    const diffTime = Math.abs(now - tradeDate);
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
                    if (diffDays <= 1) dailyVol += amount;
                    if (diffDays <= 7) weeklyVol += amount;
                    if (diffDays <= 30) monthlyVol += amount;
                }
            });

            const topTraders = Object.values(userVolumes)
                .sort((a, b) => b.volume - a.volume)
                .slice(0, 5); 
            
            let whaleText = "";
            if (topTraders.length > 0) {
                const medals = ['🥇', '🥈', '🥉', '🏅', '🏅'];
                topTraders.forEach((trader, index) => {
                    whaleText += `${medals[index]} <@${trader.id}> ⸻ \`$${trader.volume.toLocaleString()}\`\n`;
                });
            } else {
                whaleText = "No trades yet.";
            }

            const updatedEmbed = new EmbedBuilder()
                .setColor('#f1c40f') 
                .setTitle('🏦 THE VAULT | EXECUTIVE DASHBOARD')
                .setDescription('**[ 🟢 SYSTEM STATUS: ONLINE ]**\nReal-time network analytics securely fetched from the central database.')
                .addFields(
                    { name: '👥 Network Strength', value: `\`\`\`yaml\nTotal Live Members : ${liveMembers}\n\`\`\``, inline: false },
                    { name: '📈 Transaction Analytics', value: `\`\`\`yaml\nDaily (24h)   : $${dailyVol.toLocaleString()}\nWeekly (7d)   : $${weeklyVol.toLocaleString()}\nMonthly (30d) : $${monthlyVol.toLocaleString()}\n\`\`\``, inline: false },
                    { name: '🏆 Top 5 Network Whales', value: whaleText, inline: false }
                )
                .setThumbnail('https://cdn-icons-png.flaticon.com/512/3252/3252654.png') 
                .setTimestamp()
                .setFooter({ text: 'Professor Network - Secure Terminal' });

            await interaction.editReply({ embeds: [updatedEmbed] });
        } catch (error) { console.error(error); }
    }
});

async function approveUserKYC(userId, guild) {
    let verifiedRole = guild.roles.cache.find(r => r.name === 'Verified');
    if (!verifiedRole) { verifiedRole = await guild.roles.create({ name: 'Verified', color: '#2ecc71' }); }
    try {
        const member = await guild.members.fetch(userId);
        await member.roles.add(verifiedRole);
        await db.collection('users_kyc').doc(userId).update({ status: 'Approved' });
        await member.send('🏦 **Professor Network:** Congratulations! Your KYC has been approved from dashboard.').catch(() => {});
    } catch (e) { console.log("External KYC approve error", e); }
}

// ==========================================
// 🌐 WEB DASHBOARD (EXPRESS SERVER)
// ==========================================
const express = require('express');
const session = require('express-session');
const app = express();

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));

// 🌟 FIX: SESSION COCHIE AND RESAVE OPTIONS SET TO STOP SUDDEN LOGOUTS 🌟
app.use(session({
    secret: 'professor-vault-secret-key-2026',
    resave: true, // Forces session to be saved back to the session store
    saveUninitialized: true, // Forces uninitialized session to be saved
    cookie: { 
        secure: false, // Set to true if using HTTPS
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days long session persistence
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
    } catch (error) { res.render('login', { error: 'Database Connection Error.' }); }
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
            const date = d.closedAt ? d.closedAt.toDate().toLocaleString() : 'N/A';
            csv += `"${date}","${d.username}","${d.tradeType}","${d.networkOrMethod}","${d.amountUsd}","${d.closedBy || 'Admin'}"\n`;
        });
        res.header('Content-Type', 'text/csv');
        res.attachment('The_Vault_Ledger.csv');
        res.send(csv);
    } catch(e) { res.send("Export Error"); }
});

app.post('/api/kyc-approve', requireLogin, async (req, res) => {
    const { userId } = req.body;
    try {
        // Direct guild/server ID se fetch karein taaki cache empty hone par bhi crash na ho
        const guildId = '1456297708892586057'; // <--- Yahan apna asli Discord Server ID daalein (Bina brackets ke)
        const guild = await client.guilds.fetch(guildId).catch(() => null);

        if (guild) {
            await approveUserKYC(userId, guild);
            res.json({ success: true });
        } else {
            console.error("Guild fetch failed for ID:", guildId);
            res.json({ success: false, error: "Discord server connection lost or Guild ID invalid." });
        }
    } catch (e) { 
        console.error("KYC Approve API Error:", e);
        res.json({ success: false, error: e.message }); 
    }
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

            if (data.closedAt) {
                const tradeDate = data.closedAt.toDate();
                const diffTime = Math.abs(now - tradeDate);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
                if (diffDays <= 1) dailyVol += amount;
                if (diffDays <= 7) weeklyVol += amount;
                if (diffDays <= 30) monthlyVol += amount;
            }
        });

        allCompleted.sort((a, b) => {
            const dateA = a.closedAt ? a.closedAt.toDate() : 0;
            const dateB = b.closedAt ? b.closedAt.toDate() : 0;
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
            buyVol, sellVol, recentFeed
        });
    } catch (error) { res.send("Dashboard Loading Error!"); }
});

const PORT = process.env.PORT || 3000;

// '0.0.0.0' daalne se dashboard aapke laptop ke IP se bhi khulega
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 DASHBOARD READY: http://192.168.31.183:${PORT}`);
});;

client.login(process.env.DISCORD_TOKEN);