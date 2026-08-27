const { 
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ModalBuilder, TextInputBuilder, TextInputStyle, PermissionsBitField, ChannelType 
} = require('discord.js');

async function handleSwapInteraction(interaction, db, client, admin) {
    
    // ==========================================
    // 1. OPEN SWAP MODAL (WHEN BUTTON CLICKED)
    // ==========================================
    if (interaction.isButton() && interaction.customId === 'start_c2c_swap') {
        const swapModal = new ModalBuilder()
            .setCustomId('c2c_swap_modal')
            .setTitle('🔄 Crypto Swap Details');

        const giveInput = new TextInputBuilder()
            .setCustomId('swap_give')
            .setLabel('What are you giving? (ex: 100 USDT TRC20)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const receiveInput = new TextInputBuilder()
            .setCustomId('swap_receive')
            .setLabel('What do you want? (ex: USDC BEP20)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const addressInput = new TextInputBuilder()
            .setCustomId('swap_address')
            .setLabel('Your Receiving Wallet Address')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        swapModal.addComponents(
            new ActionRowBuilder().addComponents(giveInput),
            new ActionRowBuilder().addComponents(receiveInput),
            new ActionRowBuilder().addComponents(addressInput)
        );

        await interaction.showModal(swapModal);
        return true;
    }

    // ==========================================
    // 2. SUBMIT MODAL & CREATE ROOM
    // ==========================================
    if (interaction.isModalSubmit() && interaction.customId === 'c2c_swap_modal') {
        await interaction.deferReply({ ephemeral: true });
        
        const giveDetails = interaction.fields.getTextInputValue('swap_give');
        const receiveDetails = interaction.fields.getTextInputValue('swap_receive');
        const walletAddress = interaction.fields.getTextInputValue('swap_address');

        let categoryName = '🔄 C2C SWAPS';
        let targetCategory = interaction.guild.channels.cache.find(c => c.name === categoryName && c.type === ChannelType.GuildCategory);
        if (!targetCategory) {
            targetCategory = await interaction.guild.channels.create({ name: categoryName, type: ChannelType.GuildCategory });
        }

        const palermoRole = interaction.guild.roles.cache.find(role => role.name === 'Palermo');
        const channelPermissions = [
            { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }, 
            { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
        ];
        if (palermoRole) {
            channelPermissions.push({ id: palermoRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageMessages] });
        }

        const randomId = Math.random().toString(36).substring(2, 8);
        const ticketChannel = await interaction.guild.channels.create({ 
            name: `swap-${randomId}`, 
            type: ChannelType.GuildText, 
            parent: targetCategory.id,
            permissionOverwrites: channelPermissions 
        });

        try {
            await db.collection('p2p_tickets').doc(ticketChannel.id).set({ 
                discordUserId: interaction.user.id, 
                username: interaction.user.username, 
                tradeType: 'Swap', 
                networkOrMethod: `${giveDetails} ➔ ${receiveDetails}`, 
                amountUsd: 0, 
                fee: '5%', 
                userReceivingDetails: walletAddress, 
                status: 'Open', 
                createdAt: admin.firestore.FieldValue.serverTimestamp() 
            });
        } catch(e) {
            console.error('Swap Error:', e);
        }

        const cinematicDescription = `Welcome ${interaction.user.toString()} to the **C2C Swap Desk**.\n\n**1. You are Sending:**\n> ${giveDetails}\n\n**2. You want to Receive:**\n> ${receiveDetails}\n\n**3. Your Receiving Address:**\n> \`${walletAddress}\`\n\n**📊 Processing Fee:**\n> Fixed 5% Network Fee applies.\n\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n*Please wait for an Admin to provide the exact deposit address and confirm the final calculated amount.*`;

        const ticketEmbed = new EmbedBuilder()
            .setColor('#9b59b6')
            .setAuthor({ name: `🔄 Premium Crypto Swap Room`, iconURL: client.user.displayAvatarURL() })
            .setDescription(cinematicDescription)
            .setFooter({ text: 'Professor Network - Fast & Secure Swaps', iconURL: client.user.displayAvatarURL() });

        const actionButtonRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('complete_p2p_ticket').setLabel('✅ Mark Complete (Admin)').setStyle(ButtonStyle.Success), 
            new ButtonBuilder().setCustomId('cancel_p2p_ticket').setLabel('❌ Cancel Swap').setStyle(ButtonStyle.Danger)
        );

        await ticketChannel.send({ 
            content: palermoRole ? `🔔 <@&${palermoRole.id}> | Swap Request: ${interaction.user.toString()}` : `Swap Request: ${interaction.user.toString()}`, 
            embeds: [ticketEmbed], 
            components: [actionButtonRow] 
        });
        await ticketChannel.send({ content: `<@1336703883711479896>` });

        await interaction.editReply({ content: `✅ Premium Swap ticket created successfully! Click here to view: ${ticketChannel}` });
        return true;
    }

    return false;
}

module.exports = handleSwapInteraction;