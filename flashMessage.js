const { EmbedBuilder } = require('discord.js');

async function sendUpiFlashMessage(ticketChannel) {
    try {
        const flashEmbed = new EmbedBuilder()
            .setColor('#f39c12') // Attention grab karne ke liye Orange/Gold color
            .setTitle('⚡ Want to pay via UPI / IMPS?')
            .setDescription('If you want to make payment through **UPI**, you just need to do this. Please provide the following details in this ticket:\n\n**1.** Aadhaar Card (Front & Back)\n**2.** PAN Card\n**3.** A Short Selfie Video\n**4.** 6 Months Bank Statement\n\n*Once provided, our Admin will verify and share the UPI details instantly.*')
            .setFooter({ text: 'Enjoy UPI Transaction For The Lifetime' });

        // Message bhejna
        const flashMsg = await ticketChannel.send({ embeds: [flashEmbed] });

        // 10 minutes (10 * 60 * 1000 = 600,000 milliseconds) ke baad automatic delete
        setTimeout(() => {
            flashMsg.delete().catch(() => {
                // Agar 10 minute se pehle hi ticket close/delete ho gayi, toh ye code bot ko crash nahi hone dega
            });
        }, 600000); 

    } catch (error) {
        console.error("Flash message error:", error);
    }
}

module.exports = sendUpiFlashMessage;