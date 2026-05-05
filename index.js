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

client.once('ready', () => {
    console.log(`✅ BOT ONLINE: Logged in as ${client.user.tag}`);
    console.log(`🔥 FIREBASE: Connected Successfully`);
});

// --- COMMANDS ---
client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (message.content === '!p2p' && message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        const setupEmbed = new EmbedBuilder()
            .setColor('#ff0000') 
            .setTitle('🏦 Exchange Desk (P2P)')
            .setDescription('Welcome to the Professor Network.\n\nOnly verified members can start a transaction. Click below to begin.')
            .setFooter({ text: 'Automated by Your SaaS Name' });

        const startButton = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setCustomId('start_p2p_ticket').setLabel('Start Transaction').setStyle(ButtonStyle.Danger).setEmoji('💸')
            );

        await message.channel.send({ embeds: [setupEmbed], components: [startButton] });
        await message.delete();
    }

    if (message.content === '!setupkyc' && message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        const kycEmbed = new EmbedBuilder()
            .setColor('#2b2d31') 
            .setTitle('🛡️ Network KYC Verification')
            .setDescription('To maintain the highest security and anonymity, all members must complete KYC before trading.\n\nClick the button below to submit your details securely.')
            .setFooter({ text: 'Data is encrypted and stored securely.' });

        const kycButton = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setCustomId('start_kyc_form').setLabel('Start KYC').setStyle(ButtonStyle.Primary).setEmoji('📝')
            );

        await message.channel.send({ embeds: [kycEmbed], components: [kycButton] });
        await message.delete();
    }
});

// --- INTERACTION LOGIC ---
client.on('interactionCreate', async interaction => {
    
    // ==========================================
    // 🛡️ KYC SYSTEM LOGIC
    // ==========================================
    if (interaction.isButton() && interaction.customId === 'start_kyc_form') {
        const kycModal = new ModalBuilder().setCustomId('submit_kyc_modal').setTitle('🛡️ KYC Verification Form');
        const realName = new TextInputBuilder().setCustomId('kyc_name').setLabel('Full Name / Alias').setStyle(TextInputStyle.Short).setRequired(true);
        const telegramId = new TextInputBuilder().setCustomId('kyc_telegram').setLabel('Telegram ID').setStyle(TextInputStyle.Short).setRequired(true);
        const paymentInfo = new TextInputBuilder().setCustomId('kyc_payment').setLabel('Default Payment Info (UPI/Wallet)').setStyle(TextInputStyle.Paragraph).setRequired(true);

        kycModal.addComponents(new ActionRowBuilder().addComponents(realName), new ActionRowBuilder().addComponents(telegramId), new ActionRowBuilder().addComponents(paymentInfo));
        await interaction.showModal(kycModal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'submit_kyc_modal') {
        const name = interaction.fields.getTextInputValue('kyc_name');
        const telegram = interaction.fields.getTextInputValue('kyc_telegram');
        const payment = interaction.fields.getTextInputValue('kyc_payment');

        await interaction.reply({ content: '✅ Your KYC details have been submitted securely. Please wait for approval.', ephemeral: true });

        let reviewChannel = interaction.guild.channels.cache.find(c => c.name === 'kyc-requests');
        if (!reviewChannel) {
            reviewChannel = await interaction.guild.channels.create({ name: 'kyc-requests', type: ChannelType.GuildText, permissionOverwrites: [{ id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }] });
        }

        const adminEmbed = new EmbedBuilder().setColor('#e67e22').setTitle('🚨 New KYC Request').addFields({ name: 'User', value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: true }, { name: 'Name/Alias', value: name, inline: true }, { name: 'Telegram', value: telegram, inline: true }, { name: 'Payment Info', value: payment, inline: false });
        const actionButtons = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`approve_kyc_${interaction.user.id}`).setLabel('Approve').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`reject_kyc_${interaction.user.id}`).setLabel('Reject').setStyle(ButtonStyle.Danger));

        await reviewChannel.send({ embeds: [adminEmbed], components: [actionButtons] });

        await db.collection('users_kyc').doc(interaction.user.id).set({ discordId: interaction.user.id, username: interaction.user.username, name: name, telegram: telegram, paymentInfo: payment, status: 'Pending', createdAt: admin.firestore.FieldValue.serverTimestamp() });
    }

    if (interaction.isButton() && interaction.customId.startsWith('approve_kyc_')) {
        const userId = interaction.customId.replace('approve_kyc_', '');
        let verifiedRole = interaction.guild.roles.cache.find(r => r.name === 'Verified');
        if (!verifiedRole) { verifiedRole = await interaction.guild.roles.create({ name: 'Verified', color: '#2ecc71', reason: 'Auto-created for KYC verified members' }); }

        try {
            const member = await interaction.guild.members.fetch(userId);
            await member.roles.add(verifiedRole);
            await db.collection('users_kyc').doc(userId).update({ status: 'Approved' });
            await interaction.reply({ content: `✅ Successfully verified <@${userId}>!` });
            
            const oldEmbed = interaction.message.embeds[0];
            const updatedEmbed = EmbedBuilder.from(oldEmbed).setColor('#2ecc71').setTitle('✅ KYC Approved');
            await interaction.message.edit({ embeds: [updatedEmbed], components: [] });

            await member.send('🏦 **Professor Network:** Congratulations! Your KYC has been approved. You can now access the Exchange Desk and start trading.').catch(()=> console.log("User DM closed"));
        } catch (error) { await interaction.reply({ content: `Error: User might have left the server.`, ephemeral: true }); }
    }

    if (interaction.isButton() && interaction.customId.startsWith('reject_kyc_')) {
        const userId = interaction.customId.replace('reject_kyc_', '');
        await db.collection('users_kyc').doc(userId).update({ status: 'Rejected' });
        await interaction.reply({ content: `❌ KYC Rejected for <@${userId}>.` });
        
        const oldEmbed = interaction.message.embeds[0];
        const updatedEmbed = EmbedBuilder.from(oldEmbed).setColor('#e74c3c').setTitle('❌ KYC Rejected');
        await interaction.message.edit({ embeds: [updatedEmbed], components: [] });
    }

    // ==========================================
    // 💸 P2P TRANSACTION SYSTEM LOGIC 
    // ==========================================
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

    if (interaction.isModalSubmit() && interaction.customId === 'final_p2p_modal') {
        const userState = userSelections.get(interaction.user.id);
        const tradeAmount = interaction.fields.getTextInputValue('trade_amount');
        const userDetails = interaction.fields.getTextInputValue('user_receiving_details');

        await interaction.reply({ content: '🏦 Creating your secure P2P room...', ephemeral: true });

        // Pehle 'Verified' role dhoondhte hain taaki usko specifically block kar sakein
const verifiedRole = interaction.guild.roles.cache.find(role => role.name === 'Verified');

// Permission ka naya solid structure
const channelPermissions = [
    { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }, // @everyone block
    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] } // Sirf Ticket Owner allow
];

// Agar Verified role hai, toh usko bhi is channel se strictly bahar rakho
if (verifiedRole) {
    channelPermissions.push({ id: verifiedRole.id, deny: [PermissionsBitField.Flags.ViewChannel] });
}

// Ab in strict permissions ke sath private channel banayenge
const ticketChannel = await interaction.guild.channels.create({
    name: `ticket-${interaction.user.username}`,
    type: ChannelType.GuildText,
    permissionOverwrites: channelPermissions,
});

        try {
            await db.collection('p2p_tickets').doc(ticketChannel.id).set({ discordUserId: interaction.user.id, username: interaction.user.username, tradeType: userState.type, networkOrMethod: userState.step2, amountUsd: Number(tradeAmount), userReceivingDetails: userDetails, status: 'Open', createdAt: admin.firestore.FieldValue.serverTimestamp() });
        } catch (error) { console.error("Firebase Error: ", error); }

        let adminProvides = "";
        let actionDescription = "";
        let easyCopyText = ""; // NAYA: Mobile ke copy karne ke liye variable

        if (userState.type === 'Sell') {
            actionDescription = `You are **Selling Crypto**. Please transfer the crypto via **${userState.step2}** to the admin's address below.`;
            let walletAddress = "Waiting for Admin to provide address.";
            if (userState.step2 === 'TRC20') walletAddress = "TABCDEF1234567890YOURTRC20WALLETADDRESS";
            if (userState.step2 === 'ERC20') walletAddress = "0xABCDEF1234567890YOURERC20WALLETADDRESS";
            if (userState.step2 === 'BEP20') walletAddress = "0xBEP20ADDRESSEXAMPLE";
            if (userState.step2 === 'BTC') walletAddress = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
            
            adminProvides = `**Admin's Crypto Address:**\n\`\`\`${walletAddress}\`\`\``;
            easyCopyText = walletAddress; // Sirf address
        } else {
            actionDescription = `You are **Buying Crypto**. Please transfer INR via **${userState.step2}** to the admin's details below.`;
            let paymentDetails = "Waiting for Admin to provide bank details.";
            if (userState.step2 === 'UPI') paymentDetails = "admin@upi";
            if (userState.step2 === 'IMPS') paymentDetails = "Bank: SBI\nAcc: 123456789\nIFSC: SBIN0001234";
            if (userState.step2 === 'CDM') paymentDetails = "Cash Deposit Acc: 9876543210 (HDFC)";
            
            adminProvides = `**Admin's Bank/Payment Details:**\n\`\`\`${paymentDetails}\`\`\``;
            easyCopyText = paymentDetails; // Sirf details
        }

        const ticketEmbed = new EmbedBuilder().setColor('#ff0000').setTitle(`🏦 Secure P2P Room: ${interaction.user.username}`).setDescription(`Welcome, ${interaction.user.toString()}! Below are your transaction details.\n\n${actionDescription}`).addFields({ name: 'Action', value: userState.type, inline: true }, { name: 'Amount', value: `$${tradeAmount}`, inline: true }, { name: 'Method', value: userState.step2, inline: true }, { name: 'Your Provided Details', value: `\`\`\`${userDetails}\`\`\``, inline: false }, { name: '🏦 Transfer Details', value: adminProvides, inline: false }).setFooter({ text: 'Share your payment screenshot here after successful transfer.' });
        
        const closeButtonRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_p2p_ticket').setLabel('🔒 Close Ticket (Admin Only)').setStyle(ButtonStyle.Danger));

        // Embed aur button bhejna
        await ticketChannel.send({ embeds: [ticketEmbed], components: [closeButtonRow] });
        
        // 🌟 NAYA LOGIC: Mobile Easy Copy Messages 🌟
        await ticketChannel.send(`👇 **Long press below to copy details easily:** 👇`);
        await ticketChannel.send(easyCopyText);

        await interaction.editReply({ content: `✅ Ticket created successfully! Click here to view: ${ticketChannel}` });

        userSelections.delete(interaction.user.id);
    }

    // ==========================================
    // 🔒 ADMIN TICKET CLOSE & AUTO-REFRESH LOGIC 
    // ==========================================
    if (interaction.isButton() && interaction.customId === 'close_p2p_ticket') {
        
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: '❌ **Access Denied:** Only administrators can close tickets.', ephemeral: true });
        }

        await interaction.reply({ content: '🔒 Ticket closing in 5 seconds. Saving data and refreshing panel...' });

        try {
            const ticketDoc = await db.collection('p2p_tickets').doc(interaction.channel.id).get();
            if (ticketDoc.exists) {
                const ticketData = ticketDoc.data();
                const member = await interaction.guild.members.fetch(ticketData.discordUserId);
                if (member) {
                    const receiptEmbed = new EmbedBuilder().setColor('#2ecc71').setTitle('🧾 Transaction Completed').setDescription(`Hello **${ticketData.username}**,\n\nYour P2P transaction of **$${ticketData.amountUsd}** has been successfully closed by the Admin.\n\nThank you for trading with us! 🏦`).setFooter({ text: 'Professor Network - Money Heist Automated System' });
                    const serverLinkBtn = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Return to Exchange Desk').setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${interaction.guild.id}`));
                    await member.send({ embeds: [receiptEmbed], components: [serverLinkBtn] }).catch(()=> console.log("DM closed"));
                }
            }
            await db.collection('p2p_tickets').doc(interaction.channel.id).update({ status: 'Completed', closedBy: interaction.user.username, closedAt: admin.firestore.FieldValue.serverTimestamp() });

            // 🌟 NAYA LOGIC: Auto-Refresh the 'Start Transaction' Button 🌟
            // Bot `#tickets` channel dhoondhega (Agar aapke channel ka naam kuch aur hai jaise 'exchange-desk' toh yahan change kar lena)
            const mainTicketChannel = interaction.guild.channels.cache.find(c => c.name === 'tickets' || c.name === 'exchange-desk');
            
            if (mainTicketChannel) {
                // Purane bot messages dhoondh kar delete karna
                const fetchedMessages = await mainTicketChannel.messages.fetch({ limit: 10 });
                const botMessages = fetchedMessages.filter(m => m.author.id === client.user.id);
                botMessages.forEach(msg => msg.delete().catch(console.error));

                // Naya, fresh panel ekdum neeche bhejna
                const setupEmbed = new EmbedBuilder()
                    .setColor('#ff0000') 
                    .setTitle('🏦 Exchange Desk (P2P)')
                    .setDescription('Welcome to the Professor Network.\n\nOnly verified members can start a transaction. Click below to begin.')
                    .setFooter({ text: 'Automated by Your SaaS Name' });

                const startButton = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder().setCustomId('start_p2p_ticket').setLabel('Start Transaction').setStyle(ButtonStyle.Danger).setEmoji('💸')
                    );

                await mainTicketChannel.send({ embeds: [setupEmbed], components: [startButton] });
            }

        } catch (error) {
            console.error("Error: ", error);
        }

        setTimeout(() => {
            interaction.channel.delete().catch(console.error);
        }, 5000);
    }
});

client.login(process.env.DISCORD_TOKEN);