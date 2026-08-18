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
            .setLabel('Amount in INR (₹)')
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
            await interaction.reply({ content: '❌ Error: Is ticket se juda koi active `/ac` session nahi mila.', ephemeral: true });
            return true;
        }

        await interaction.reply({ content: `⏳ *Re-flashing... Scanning open Buy tickets for ₹${session.targetAmountInr} or more...*`, ephemeral: true });

        try {
            const snapshot = await db.collection('p2p_tickets')
                .where('tradeType', '==', 'Buy')
                .where('status', '==', 'Open')
                .get();

            let matchedChannels = [];

            snapshot.forEach(doc => {
                const data = doc.data();
                if (data.networkOrMethod && data.networkOrMethod.includes('CCW')) return;
                
                const ticketInr = data.totalInr || (data.amountUsd * 88); 

                if (ticketInr >= session.targetAmountInr) {
                    const channel = interaction.guild.channels.cache.get(doc.id);
                    if (channel) {
                        if (channel.parent && channel.parent.name.toUpperCase().includes('COMPLETED')) return;
                        matchedChannels.push({ channel, data });
                    }
                }
            });

            if (matchedChannels.length === 0) {
                await interaction.editReply({ content: `❌ **No match found.** Koi bhi active buyer nahi hai jiska amount ₹${session.targetAmountInr} ya usse zyada ho.` });
                return true;
            }

            session.status = 'pending';
            session.buyerTicketId = null;
            session.messages = [];
            session.adminInteraction = interaction; 

            const embed = new EmbedBuilder()
                .setColor('#e67e22') 
                .setTitle('⚡ VIP MATCH FOUND (RE-FLASHED) ⚡')
                .setDescription(`Ek seller phirse available hua hai!\n\n🏦 **Bank Name:** \`${session.bankName}\`\n💰 **Amount Required:** **₹${session.targetAmountInr}**\n\nAgar aap is trade ko abhi process karna chahte hain, toh turant **Claim** par click karein!`)
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
                } catch (e) {}
            }

            global.matchSessions.set(matchId, session);

            const statusRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`ac_status_${matchId}`).setLabel('🔄 Manual Check (Backup)').setStyle(ButtonStyle.Secondary)
            );

            await interaction.editReply({ 
                content: `✅ **Re-Flashed!** Match details ${matchedChannels.length} tickets mein wapas bhej di gayi hain.\n\n⏳ **Status:** Waiting for buyers to claim...\n\n*(🤫 Jaise hi koi naya buyer claim karega, yeh message apne aap update ho jayega!)*`, 
                components: [statusRow] 
            });

        } catch (error) { await interaction.editReply({ content: `❌ Error scanning tickets.` }); }
        return true;
    }

    // ==========================================
    // ⚡ 3. /CL COMMAND LOGIC (CLEAR/CANCEL FLASH)
    // ==========================================
    if (interaction.isChatInputCommand() && interaction.commandName === 'cl') {
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
            await interaction.reply({ content: '❌ Error: Is ticket se juda koi active `/ac` session nahi mila.', ephemeral: true });
            return true;
        }

        if (session.status === 'claimed') {
            await interaction.reply({ content: '❌ Error: Yeh deal pehle hi kisi buyer ne claim kar li hai.', ephemeral: true });
            return true;
        }

        await interaction.deferReply({ ephemeral: true });

        // Sabhi tickets se flash message delete karna
        let deletedCount = 0;
        for (const msgData of session.messages) {
            try {
                const channel = interaction.guild.channels.cache.get(msgData.channelId);
                if (channel) {
                    const msgToDel = await channel.messages.fetch(msgData.messageId);
                    if (msgToDel) {
                        await msgToDel.delete();
                        deletedCount++;
                    }
                }
            } catch (e) {}
        }

        // Admin ke original message ko update kar dena
        if (session.adminInteraction) {
            try {
                await session.adminInteraction.editReply({
                    content: `🛑 **Match Cancelled by Admin!**\n\nYeh deal aapke dwara manual close/clear kar di gayi hai. Saare buyers ki tickets se flash messages delete ho gaye hain.`,
                    components: [] 
                });
            } catch (err) {}
        }

        // Session ko memory se hata do
        global.matchSessions.delete(matchId);

        await interaction.editReply({ content: `✅ **Success!** ${deletedCount} tickets se flash details delete kar di gayi hain aur system clear ho gaya hai.` });
        return true;
    }

    // ==========================================
    // ⚡ 4. MODAL SUBMIT (FIRST TIME SENDING)
    // ==========================================
    if (interaction.isModalSubmit() && interaction.customId === 'ac_match_modal') {
        const bankName = interaction.fields.getTextInputValue('ac_bank_name');
        const targetAmountInr = parseFloat(interaction.fields.getTextInputValue('ac_amount'));

        if (isNaN(targetAmountInr)) {
            await interaction.reply({ content: '❌ Invalid Amount! Sirf numbers daaliye.', ephemeral: true });
            return true;
        }

        await interaction.reply({ content: `⏳ *Scanning open Buy tickets for ₹${targetAmountInr} or more...*`, ephemeral: true });

        try {
            const snapshot = await db.collection('p2p_tickets')
                .where('tradeType', '==', 'Buy')
                .where('status', '==', 'Open')
                .get();

            let matchedChannels = [];

            snapshot.forEach(doc => {
                const data = doc.data();
                if (data.networkOrMethod && data.networkOrMethod.includes('CCW')) return;
                
                const ticketInr = data.totalInr || (data.amountUsd * 88); 

                if (ticketInr >= targetAmountInr) {
                    const channel = interaction.guild.channels.cache.get(doc.id);
                    if (channel) {
                        if (channel.parent && channel.parent.name.toUpperCase().includes('COMPLETED')) return;
                        matchedChannels.push({ channel, data });
                    }
                }
            });

            if (matchedChannels.length === 0) {
                await interaction.editReply({ content: `❌ **No match found.** Koi bhi active buyer nahi hai jiska amount ₹${targetAmountInr} ya usse zyada ho.` });
                return true;
            }

            const matchId = Date.now().toString();
            const sessionData = {
                adminInteraction: interaction, 
                adminId: interaction.user.id,
                sellerTicketId: interaction.channel.id,
                buyerTicketId: null,
                bankName: bankName, 
                targetAmountInr: targetAmountInr, 
                messages: [],
                status: 'pending'
            };

            const embed = new EmbedBuilder()
                .setColor('#3498db')
                .setTitle('⚡ VIP MATCH FOUND ⚡')
                .setDescription(`Ek naya seller available hai!\n\n🏦 **Bank Name:** \`${bankName}\`\n💰 **Amount Required:** **₹${targetAmountInr}**\n\nAgar aap is trade ko abhi process karna chahte hain, toh turant **Claim** par click karein!`)
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
                new ButtonBuilder().setCustomId(`ac_status_${matchId}`).setLabel('🔄 Manual Check (Backup)').setStyle(ButtonStyle.Secondary)
            );

            await interaction.editReply({ 
                content: `✅ **Found ${matchedChannels.length} matching tickets!** Details buyers ko bhej di gayi hain.\n\n⏳ **Status:** Waiting for buyers to claim...\n\n*(🤫 Jaise hi koi buyer claim karega, **yeh message apne aap update ho jayega**)*`, 
                components: [statusRow] 
            });

        } catch (error) { await interaction.editReply({ content: `❌ Error scanning tickets.` }); }
        return true;
    }

    // ==========================================
    // ⚡ 5. BUTTON CLICK LOGIC (CLAIM / CANCEL)
    // ==========================================
    if (interaction.isButton()) {
        if (interaction.customId.startsWith('ac_claim_')) {
            const matchId = interaction.customId.replace('ac_claim_', '');
            const session = global.matchSessions.get(matchId);

            if (!session) return interaction.reply({ content: '❌ Yeh match session expire ho chuka hai.', ephemeral: true });
            if (session.status !== 'pending') return interaction.reply({ content: '❌ Too Late! Kisi aur buyer ne yeh deal pehle claim kar li.', ephemeral: true });

            session.status = 'claimed';
            session.buyerTicketId = interaction.channel.id; 
            global.matchSessions.set(matchId, session);

            await interaction.update({ content: '✅ **You successfully claimed this deal!** Admin aapse yahan abhi baat karenge.', embeds: [], components: [] });

            if (session.adminInteraction) {
                try {
                    await session.adminInteraction.editReply({
                        content: `🎉 **VIP MATCH CLAIMED!** 🚀\n\nEk buyer ne details claim kar li hain.\n🔗 **Click Here To Go To Buyer:** <#${interaction.channel.id}>\n\n*(Aap buyer ke paas jaakar confirm karein. Agar buyer backout kare, toh yahan \`/re\` type karein wapas details flash karne ke liye!)*`,
                        components: [] 
                    });
                } catch (err) {}
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

            if (!session) return interaction.reply({ content: '❌ Yeh session expire ho chuka hai.', ephemeral: true });
            if (session.status === 'pending') return interaction.reply({ content: '⏳ **Still Waiting...** Kisi buyer ne abhi tak claim nahi kiya hai. Thodi der baad wapas try karein!', ephemeral: true });
            
            if (session.status === 'claimed') {
                await interaction.update({ 
                    content: `🎉 **Match Claimed by Buyer!**\n\n🔗 **Click Here To Go To Buyer:** <#${session.buyerTicketId}>\n\n*(Aap buyer ke paas jaakar confirm karein. Agar buyer backout kare, toh yahan \`/re\` type karein wapas details flash karne ke liye!)*`, 
                    components: [] 
                });
                return true;
            }
        }
    }

    return false; 
}

module.exports = handleAutoConnect;