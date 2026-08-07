const axios = require('axios');
const { EmbedBuilder } = require('discord.js');
const { ethers } = require('ethers');

// ==========================================
// 🛠️ CONFIGURATION (Aapke Real Wallets Set Hain)
// ==========================================
const ALERT_CHANNEL_ID = '1515980898196000831'; // Is channel mein bot notification bhejega (Bank Details ya Logs channel ID yahan daalein)

const WALLETS = {
    TRON: 'TAWUyhkEHUj5ySkWK4CbUPrPqTRY8BfzoL', // TRC20 Wallet
    EVM: '0xA1fFc6eCBAa8B5e17489B483Cc7D9E5F4Ccc0416'  // ERC20, BEP20, Arbitrum & USDC Wallet
};

// ==========================================
// 🔗 1. TRC20 (TRON) TRACKER - Polling Method
// ==========================================
const USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
let lastTrc20Time = Date.now(); // Bot start hone ke baad aane wale payment hi pakdega

async function trackTRC20(client) {
    try {
        const url = `https://api.trongrid.io/v1/accounts/${WALLETS.TRON}/transactions/trc20?contract_address=${USDT_TRC20_CONTRACT}&limit=5`;
        const response = await axios.get(url);
        
        if (response.data && response.data.data) {
            const transactions = response.data.data;
            for (const tx of transactions) {
                // Agar tx naya hai aur hamare wallet mein aaya hai
                if (tx.to === WALLETS.TRON && tx.block_timestamp > lastTrc20Time) {
                    const amount = parseFloat(tx.value) / 1e6; // Tron USDT has 6 decimals
                    
                    if (amount > 0) { // Zero transfer scam se bachne ke liye
                        sendDiscordAlert(client, amount, 'USDT TRC20 (Tron)', tx.from, `https://tronscan.org/#/transaction/${tx.transaction_id}`);
                    }
                    lastTrc20Time = tx.block_timestamp; 
                }
            }
        }
    } catch (error) {
        console.error("⚠️ TRC20 Tracking Error:", error.message);
    }
}

// ==========================================
// 🔗 2. EVM TRACKER (ERC20, BEP20, ARBITRUM) - WebSocket
// ==========================================
const erc20Abi = [ "event Transfer(address indexed from, address indexed to, uint amount)" ];

function trackEVM(client, rpcUrl, tokenAddress, networkName, decimals, explorerUrl) {
    try {
        const provider = new ethers.WebSocketProvider(rpcUrl);
        const contract = new ethers.Contract(tokenAddress, erc20Abi, provider);

        console.log(`📡 Live Tracking Started for ${networkName}`);

        contract.on("Transfer", async (from, to, amount, event) => {
            // Agar paisa hamare EVM wallet mein aaya hai
            if (to.toLowerCase() === WALLETS.EVM.toLowerCase()) {
                const formattedAmount = ethers.formatUnits(amount, decimals);
                if (parseFloat(formattedAmount) > 0) {
                    const txLink = `${explorerUrl}${event.log.transactionHash}`;
                    sendDiscordAlert(client, formattedAmount, networkName, from, txLink);
                }
            }
        });

        // Agar connection disconnect ho jaye toh auto-reconnect logic
        provider.on("error", (error) => {
            console.error(`⚠️ WebSocket Error on ${networkName}:`, error);
            setTimeout(() => trackEVM(client, rpcUrl, tokenAddress, networkName, decimals, explorerUrl), 5000);
        });

    } catch (error) {
        console.error(`⚠️ Failed to start tracker for ${networkName}:`, error.message);
    }
}

// ==========================================
// 📢 DISCORD ALERT SENDER
// ==========================================
async function sendDiscordAlert(client, amount, network, sender, txLink) {
    try {
        const channel = client.channels.cache.get(ALERT_CHANNEL_ID);
        if (!channel) return;

        const embed = new EmbedBuilder()
            .setTitle('🚨 Crypto Payment Arrived!')
            .setColor('#2ecc71')
            .setDescription(`A new transaction has just hit the Vault Wallet.`)
            .addFields(
                { name: '💰 Amount Received', value: `**$${amount}**`, inline: true },
                { name: '🌐 Network', value: `\`${network}\``, inline: true },
                { name: '📤 Sender Address', value: `\`${sender}\``, inline: false },
                { name: '🔗 Blockchain Explorer', value: `[View Transaction Here](${txLink})`, inline: false }
            )
            .setTimestamp()
            .setFooter({ text: 'Professor Network - Vault Tracker' });

        await channel.send({ content: '<@1336703883711479896> 🔔 Payment Alert!', embeds: [embed] });
    } catch (err) {
        console.error("Discord Alert Error:", err);
    }
}

// ==========================================
// 🚀 MASTER EXPORT FUNCTION
// ==========================================
module.exports = function startPaymentTrackers(client) {
    console.log("🏦 Initializing Crypto Payment Trackers...");

    // 1. Start TRC20 Polling (Every 15 Seconds)
    setInterval(() => trackTRC20(client), 15000);

    // 2. Start EVM WebSockets
    // ERC20 USDT (Decimals: 6)
    trackEVM(client, 'wss://ethereum-rpc.publicnode.com', '0xdAC17F958D2ee523a2206206994597C13D831ec7', 'USDT ERC20', 6, 'https://etherscan.io/tx/');
    
    // BEP20 USDT (Decimals: 18)
    trackEVM(client, 'wss://bsc-rpc.publicnode.com', '0x55d398326f99059fF775485246999027B3197955', 'USDT BEP20', 18, 'https://bscscan.com/tx/');
    
    // Arbitrum USDT (Decimals: 6)
    trackEVM(client, 'wss://arbitrum-one-rpc.publicnode.com', '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', 'USDT Arbitrum', 6, 'https://arbiscan.io/tx/');
};