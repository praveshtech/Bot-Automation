const axios = require('axios');
const { EmbedBuilder } = require('discord.js');
const { ethers } = require('ethers');

// ==========================================
// 🛠️ CONFIGURATION
// ==========================================
const ALERT_CHANNEL_ID = '1515980898196000831'; 

const WALLETS = {
    TRON: 'TAWUyhkEHUj5ySkWK4CbUPrPqTRY8BfzoL', 
    EVM: '0xA1fFc6eCBAa8B5e17489B483Cc7D9E5F4Ccc0416'  
};

// ==========================================
// 🔗 1. TRC20 (TRON) TRACKER - HTTP Polling
// ==========================================
const USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
let lastTrc20Time = Date.now(); 

async function trackTRC20(client) {
    try {
        const url = `https://api.trongrid.io/v1/accounts/${WALLETS.TRON}/transactions/trc20?contract_address=${USDT_TRC20_CONTRACT}&limit=5`;
        const response = await axios.get(url);
        
        if (response.data && response.data.data) {
            const transactions = response.data.data;
            for (const tx of transactions) {
                if (tx.to === WALLETS.TRON && tx.block_timestamp > lastTrc20Time) {
                    const amount = parseFloat(tx.value) / 1e6; 
                    if (amount > 0) { 
                        sendDiscordAlert(client, amount, 'USDT TRC20 (Tron)', tx.from, `https://tronscan.org/#/transaction/${tx.transaction_id}`);
                    }
                    lastTrc20Time = tx.block_timestamp; 
                }
            }
        }
    } catch (error) {
        // Silent error to prevent freezing
    }
}

// ==========================================
// 🔗 2. EVM TRACKER (ERC20, BEP20, ARBITRUM) - HTTP Polling (SAFE MODE)
// ==========================================
const erc20Abi = [ "event Transfer(address indexed from, address indexed to, uint amount)" ];

async function trackEVM(client, rpcUrl, tokenAddress, networkName, decimals, explorerUrl) {
    try {
        // Changed to JsonRpcProvider (HTTP) instead of WebSocket
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const contract = new ethers.Contract(tokenAddress, erc20Abi, provider);
        
        let lastBlock = await provider.getBlockNumber();
        console.log(`📡 HTTP Tracking Started for ${networkName} (Block: ${lastBlock})`);

        // Check every 15 seconds without freezing the bot
        setInterval(async () => {
            try {
                const currentBlock = await provider.getBlockNumber();
                if (currentBlock > lastBlock) {
                    const events = await contract.queryFilter("Transfer", lastBlock + 1, currentBlock);
                    
                    for (const event of events) {
                        const from = event.args[0];
                        const to = event.args[1];
                        const amount = event.args[2];

                        if (to.toLowerCase() === WALLETS.EVM.toLowerCase()) {
                            const formattedAmount = ethers.formatUnits(amount, decimals);
                            if (parseFloat(formattedAmount) > 0) {
                                const txLink = `${explorerUrl}${event.transactionHash}`;
                                sendDiscordAlert(client, formattedAmount, networkName, from, txLink);
                            }
                        }
                    }
                    lastBlock = currentBlock;
                }
            } catch (err) {
                // Ignore temporary network timeouts so bot doesn't freeze
            }
        }, 15000); 

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
    console.log("🏦 Initializing Safe HTTP Crypto Payment Trackers...");

    // 1. TRC20 Polling
    setInterval(() => trackTRC20(client), 15000);

    // 2. EVM Polling (Using HTTPS instead of WSS to prevent Discord Freezing)
    trackEVM(client, 'https://ethereum-rpc.publicnode.com', '0xdAC17F958D2ee523a2206206994597C13D831ec7', 'USDT ERC20', 6, 'https://etherscan.io/tx/');
    trackEVM(client, 'https://bsc-rpc.publicnode.com', '0x55d398326f99059fF775485246999027B3197955', 'USDT BEP20', 18, 'https://bscscan.com/tx/');
    trackEVM(client, 'https://arbitrum-one-rpc.publicnode.com', '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', 'USDT Arbitrum', 6, 'https://arbiscan.io/tx/');
};