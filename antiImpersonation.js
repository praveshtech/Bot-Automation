const { EmbedBuilder, PermissionsBitField } = require('discord.js');

const modIds = ['1336703883711479896', '1541859306050162750', '1001128047128358923'];

async function checkAndBanImpersonator(member, client) {
    if (!member || !member.user || member.user.bot) return false;
    if (modIds.includes(member.id)) return false; 

    try {
        if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return false;
    } catch(e) {}

    const targetNames = [
        (member.nickname || "").toLowerCase(),
        (member.user.username || "").toLowerCase(),
        (member.user.globalName || "").toLowerCase()
    ].filter(n => n.length > 0);

    let isImpersonating = false;

    for (const modId of modIds) {
        try {
            let modUser = client.users.cache.get(modId) || await client.users.fetch(modId).catch(()=>null);
            let modMember = member.guild.members.cache.get(modId) || await member.guild.members.fetch(modId).catch(()=>null);

            if (!modUser) continue;

            const protectedNames = [
                modUser.username.toLowerCase(),
                modUser.globalName ? modUser.globalName.toLowerCase() : null,
                modMember && modMember.nickname ? modMember.nickname.toLowerCase() : null
            ].filter(n => n && n.length > 2); 

            for (const pName of protectedNames) {
                if (targetNames.some(tName => tName.includes(pName))) {
                    isImpersonating = true;
                    break;
                }
            }
        } catch (err) {}
        if (isImpersonating) break;
    }

    if (isImpersonating) {
        try {
            await member.ban({ reason: 'Auto-Ban: Impersonating Official Mod/Admin to scam users.' });

            const p2pChannel = member.guild.channels.cache.find(c => c.name === '💬・p2p-chat' || c.name.includes('p2p-chat'));
            if (p2pChannel) {
                const banEmbed = new EmbedBuilder()
                    .setColor('#e74c3c')
                    .setTitle('🚨 SCAMMER AUTO-BANNED 🚨')
                    .setDescription(`A user just tried to change their name to **"${member.nickname || member.user.globalName || member.user.username}"** to impersonate our Official Team.\n\n🛡️ **Tokyo AI Security has permanently banned them from the Vault.**\n\n⚠️ **Remember:** Admins will NEVER DM you first. If someone DMs you for a trade, they are 100% a scammer!`)
                    .setFooter({ text: 'Professor Network - Active Security', iconURL: member.guild.iconURL() })
                    .setTimestamp();

                await p2pChannel.send({ content: '@everyone 🛡️ **Security Alert**', embeds: [banEmbed] });
            }
            return true;
        } catch (err) {
            console.error(`❌ Could not ban impersonator ${member.user.username}:`, err);
        }
    }
    return false;
}

function setupAntiImpersonation(client) {
    client.on('guildMemberAdd', async (member) => { 
        await checkAndBanImpersonator(member, client); 
    });

    client.on('guildMemberUpdate', async (oldMember, newMember) => { 
        if (oldMember.nickname !== newMember.nickname) await checkAndBanImpersonator(newMember, client); 
    });

    client.on('userUpdate', async (oldUser, newUser) => {
        if (oldUser.username !== newUser.username || oldUser.globalName !== newUser.globalName) {
            client.guilds.cache.forEach(async guild => {
                const member = await guild.members.fetch(newUser.id).catch(() => null);
                if (member) await checkAndBanImpersonator(member, client);
            });
        }
    });
}

module.exports = setupAntiImpersonation;