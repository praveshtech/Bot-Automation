const { 
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ModalBuilder, TextInputBuilder, TextInputStyle, PermissionsBitField 
} = require('discord.js');

async function handleAutoConnect(interaction, db) {
    // ==========================================
    // ⚡ 1. /AC COMMAND LOGIC (INITIAL SETUP)
    // ==========================================
    if (interaction.isChatInputCommand() && interaction.commandName === 'ac') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) && !interaction.member.roles.cache.some(role => role.name === 'Palermo')) {
            await interaction.reply({ content: '❌ Access Denied.', ephemeral: true });
            return true;
        }

        const modal = new ModalBuilder()
            .setCustomId('ac_match_modal')
            .setTitle('Auto-Connect Matchmaking');

        const bankInput = new TextInputBuilder()
            .setCustomId('ac_bank_name')
            .setLabel('Bank Name (e.g. SBI, ICICI)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const amountInput = new TextInputBuilder()
            .setCustomId('ac_amount')
            .setLabel('Amount in USDT ($)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(bankInput),
            new ActionRowBuilder().addComponents(amountInput)
        );

        await interaction.showModal(modal);
        return true;
    }

    // ==========================================
    // ⚡ 2. /RE COMMAND LOGIC (RE-FLASH MATCH)
    // ==========================================
    if (interaction.isChatInputCommand() && interaction.commandName === 're') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) && !interaction.member.roles.cache.some(role => role.name === 'Palermo')) {
            await interaction.reply({ content: '❌ Access Denied.', ephemeral: true });
            return true;
        }

        let matchId = null;
        let session = null;
        for (const [key, val] of global.matchSessions.entries()) {
            if (val.sellerTicketId === interaction.channel.id || val.buyerTicketId === interaction.channel.id) {
                matchId = key;
                session = val;
                break;
            }
        }

        if (!session) {
            await interaction.reply({ content: '❌ Error: No active `/ac` session found linked to this ticket.', ephemeral: true });
            return true;
        }

        await interaction.reply({ content: `⏳ *Re-flashing... Scanning open Buy tickets for $${session.targetAmount} or more...*`, ephemeral: true });

        try {
            const snapshot = await db.collection('p2p_tickets')
                .where('tradeType', '==', 'Buy')
                .where('status', '==', 'Open')
                .get();

            let matchedChannels = [];

            snapshot.forEach(doc => {
                const data = doc.data();
                
                // 🔥 NAYA RULE: CCW FOR BUY wali tickets ko ignore kar do
                if (data.networkOrMethod && data.networkOrMethod.includes('CCW')) return;

                if (data.amountUsd >= session.targetAmount) {
                    const channel = interaction.guild.channels.cache.get(doc.id);
                    if (channel) matchedChannels.push({ channel, data });
                }
            });

            if (matchedChannels.length === 0) {
                await interaction.editReply({ content: `❌ **No match found.** There are no active buyers with an amount of $${session.targetAmount} or more.` });
                return true;
            }

            session.status = 'pending';
            session.buyerTicketId = null;
            session.messages = [];
            session.adminInteraction = interaction; 

            const embed = new EmbedBuilder()
                .setColor('#e67e22') 
                .setTitle('⚡ VIP MATCH FOUND (RE-FLASHED) ⚡')
                .setDescription(`A seller is available again!\n\n🏦 **Bank Name:** \`${session.bankName}\`\n💰 **Amount Required:** **$${session.targetAmount}**\n\nIf you want to process this trade right now, click **Claim Match** immediately!`)
                .setFooter({ text: 'Professor Network - Fast Matchmaking' });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`ac_claim_${matchId}`).setLabel('✅ Claim Match').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`ac_cancel_${matchId}`).setLabel('❌ Cancel').setStyle(ButtonStyle.Danger)
            );

            for (const match of matchedChannels) {
                try {
                    const msg = await match.channel.send({ 
                        content: `<@${match.data.discordUserId}> 🔔 **Alert: Ready Seller Available!**`, 
                        embeds: [embed], 
                        components: [row] 
                    });
                    session.messages.push({ channelId: match.channel.id, messageId: msg.id });
                } catch (e) { console.error('Failed to send re-match', match.channel.id); }
            }

            global.matchSessions.set(matchId, session);

            const statusRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`ac_status_${matchId}`)
                    .setLabel('🔄 Manual Check (Backup)')
                    .setStyle(ButtonStyle.Secondary)
            );

            await interaction.editReply({ 
                content: `✅ **Re-Flashed!** Match details have been resent to ${matchedChannels.length} tickets.\n\n⏳ **Status:** Waiting for buyers to claim...\n\n*(🤫 As soon as a new buyer claims, this message will update automatically!)*`, 
                components: [statusRow] 
            });

        } catch (error) {
            console.error('AC Re-Match Error:', error);
            await interaction.editReply({ content: `❌ Error scanning tickets.` });
        }
        return true;
    }

    // ==========================================
    // ⚡ 3. MODAL SUBMIT (FIRST TIME SENDING)
    // ==========================================
    if (interaction.isModalSubmit() && interaction.customId === 'ac_match_modal') {
        const bankName = interaction.fields.getTextInputValue('ac_bank_name');
        const targetAmount = parseFloat(interaction.fields.getTextInputValue('ac_amount'));

        if (isNaN(targetAmount)) {
            await interaction.reply({ content: '❌ Invalid Amount! Please enter numbers only.', ephemeral: true });
            return true;
        }

        await interaction.reply({ content: `⏳ *Scanning open Buy tickets for $${targetAmount} or more...*`, ephemeral: true });

        try {
            const snapshot = await db.collection('p2p_tickets')
                .where('tradeType', '==', 'Buy')
                .where('status', '==', 'Open')
                .get();

            let matchedChannels = [];

            snapshot.forEach(doc => {
                const data = doc.data();

                // 🔥 NAYA RULE: CCW FOR BUY wali tickets ko ignore kar do
                if (data.networkOrMethod && data.networkOrMethod.includes('CCW')) return;

                if (data.amountUsd >= targetAmount) {
                    const channel = interaction.guild.channels.cache.get(doc.id);
                    if (channel) matchedChannels.push({ channel, data });
                }
            });

            if (matchedChannels.length === 0) {
                await interaction.editReply({ content: `❌ **No match found.** There are no active buyers with an amount of $${targetAmount} or more.` });
                return true;
            }

            const matchId = Date.now().toString();
            const sessionData = {
                adminInteraction: interaction, 
                adminId: interaction.user.id,
                sellerTicketId: interaction.channel.id,
                buyerTicketId: null,
                bankName: bankName, 
                targetAmount: targetAmount, 
                messages: [],
                status: 'pending'
            };

            const embed = new EmbedBuilder()
                .setColor('#3498db')
                .setTitle('⚡ VIP MATCH FOUND ⚡')
                .setDescription(`A new seller is available!\n\n🏦 **Bank Name:** \`${bankName}\`\n💰 **Amount Required:** **$${targetAmount}**\n\nIf you want to process this trade right now, click **Claim Match** immediately!`)
                .setFooter({ text: 'Professor Network - Fast Matchmaking' });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`ac_claim_${matchId}`).setLabel('✅ Claim Match').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`ac_cancel_${matchId}`).setLabel('❌ Cancel').setStyle(ButtonStyle.Danger)
            );

            for (const match of matchedChannels) {
                try {
                    const msg = await match.channel.send({ 
                        content: `<@${match.data.discordUserId}> 🔔 **Alert: Ready Seller Available!**`, 
                        embeds: [embed], 
                        components: [row] 
                    });
                    sessionData.messages.push({ channelId: match.channel.id, messageId: msg.id });
                } catch (e) {}
            }

            global.matchSessions.set(matchId, sessionData);

            const statusRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`ac_status_${matchId}`)
                    .setLabel('🔄 Manual Check (Backup)')
                    .setStyle(ButtonStyle.Secondary)
            );

            await interaction.editReply({ 
                content: `✅ **Found ${matchedChannels.length} matching tickets!** Details have been sent to the buyers.\n\n⏳ **Status:** Waiting for buyers to claim...\n\n*(🤫 As soon as a buyer claims, **this message will update automatically**)*`, 
                components: [statusRow] 
            });

        } catch (error) {
            console.error('AC Match Error:', error);
            await interaction.editReply({ content: `❌ Error scanning tickets.` });
        }
        return true;
    }

    // ==========================================
    // ⚡ 4. BUTTON CLICK LOGIC (CLAIM / CANCEL)
    // ==========================================
    if (interaction.isButton()) {
        
        if (interaction.customId.startsWith('ac_claim_')) {
            const matchId = interaction.customId.replace('ac_claim_', '');
            const session = global.matchSessions.get(matchId);

            if (!session) {
                await interaction.reply({ content: '❌ This match session has expired.', ephemeral: true });
                return true;
            }
            
            if (session.status !== 'pending') {
                await interaction.reply({ content: '❌ Too Late! Another buyer has already claimed this deal.', ephemeral: true });
                return true;
            }

            session.status = 'claimed';
            session.buyerTicketId = interaction.channel.id; 
            global.matchSessions.set(matchId, session);

            await interaction.update({ content: '✅ **You successfully claimed this deal!** Admin will communicate with you here shortly.', embeds: [], components: [] });

            if (session.adminInteraction) {
                try {
                    await session.adminInteraction.editReply({
                        content: `🎉 **VIP MATCH CLAIMED!** 🚀\n\nA buyer has claimed the details.\n🔗 **Click Here To Go To Buyer:** <#${interaction.channel.id}>\n\n*(Please visit the buyer's ticket to confirm. If the buyer backs out, type \`/re\` here to flash the details again!)*`,
                        components: [] 
                    });
                } catch (err) { console.error('Auto-update failed:', err); }
            }

            for (const msgData of session.messages) {
                if (msgData.channelId !== interaction.channel.id) {
                    try {
                        const channel = interaction.guild.channels.cache.get(msgData.channelId);
                        if (channel) {
                            const msgToDel = await channel.messages.fetch(msgData.messageId);
                            if (msgToDel) await msgToDel.delete();
                        }
                    } catch (e) {}
                }
            }
            return true; 
        }

        if (interaction.customId.startsWith('ac_cancel_')) {
            try { await interaction.message.delete(); } catch (e) {}
            return true;
        }

        if (interaction.customId.startsWith('ac_status_')) {
            const matchId = interaction.customId.replace('ac_status_', '');
            const session = global.matchSessions.get(matchId);

            if (!session) {
                await interaction.reply({ content: '❌ This session has expired.', ephemeral: true });
                return true;
            }

            if (session.status === 'pending') {
                await interaction.reply({ content: '⏳ **Still Waiting...** No buyer has claimed it yet. Please try again in a little while!', ephemeral: true });
                return true;
            }

            if (session.status === 'claimed') {
                await interaction.update({ 
                    content: `🎉 **Match Claimed by Buyer!**\n\n🔗 **Click Here To Go To Buyer:** <#${session.buyerTicketId}>\n\n*(Please visit the buyer's ticket to confirm. If the buyer backs out, type \`/re\` here to flash the details again!)*`, 
                    components: [] 
                });
                return true;
            }
        }
    }

    return false; 
}

module.exports = handleAutoConnect;