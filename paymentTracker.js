const axios = require('axios');
const { EmbedBuilder } = require('discord.js');
const { ethers } = require('ethers');
const cron = require('node-cron'); // 🔥 Cron Job for Daily Report

// ==========================================
// 🛠️ CONFIGURATION
// ==========================================
const ALERT_CHANNEL_ID = '1535194410340450365'; 
// 👇 Yahan apne naye 'usdt-transactions' channel ki ID daal dijiye
const REPORT_CHANNEL_ID = '1536752429578850374'; 

const WALLETS = {
    TRON: 'TAWUyhkEHUj5ySkWK4CbUPrPqTRY8BfzoL', 
    EVM: '0xA1fFc6eCBAa8B5e17489B483Cc7D9E5F4Ccc0416'  
};

// ==========================================
// 📊 DAILY STATS TRACKER (Resets every night)
// ==========================================
let dailyStats = {
    'USDT TRC20 (Tron)': 0,
    'USDT ERC20': 0,
    'USDT BEP20': 0,
    'USDT Arbitrum': 0,
    'USDC ERC20': 0,
    'USDC BEP20': 0
};

// ==========================================
// 🔗 1. TRC20 (TRON) TRACKER - Smart Loop
// ==========================================
const USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
let lastTrc20Time = Date.now(); 

async function trackTRC20(client) {
    try {
        const url = `https://api.trongrid.io/v1/accounts/${WALLETS.TRON}/transactions/trc20?contract_address=${USDT_TRC20_CONTRACT}&limit=5`;
        const response = await axios.get(url, { timeout: 8000 });
        
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
        // Silent error to prevent bot crash
    }
    setTimeout(() => trackTRC20(client), 15000);
}

// ==========================================
// 🔗 2. EVM TRACKER - Anti-Freeze & Smart Filter Mode
// ==========================================
const erc20Abi = [ "event Transfer(address indexed from, address indexed to, uint amount)" ];

async function trackEVM(client, rpcUrl, tokenAddress, networkName, decimals, explorerUrl) {
    let provider;
    let contract;
    let lastBlock;
    let myWalletFilter;

    try {
        provider = new ethers.JsonRpcProvider(rpcUrl);
        contract = new ethers.Contract(tokenAddress, erc20Abi, provider);
        lastBlock = await provider.getBlockNumber();
        myWalletFilter = contract.filters.Transfer(null, WALLETS.EVM);
        console.log(`📡 Smart Tracking Started for ${networkName} (Block: ${lastBlock})`);
    } catch (err) {
        console.log(`⚠️ Initial connection delayed for ${networkName}, will retry...`);
    }

    async function poll() {
        try {
            if (!provider || !lastBlock) {
                provider = new ethers.JsonRpcProvider(rpcUrl);
                contract = new ethers.Contract(tokenAddress, erc20Abi, provider);
                lastBlock = await provider.getBlockNumber();
                myWalletFilter = contract.filters.Transfer(null, WALLETS.EVM);
            }

            const currentBlock = await provider.getBlockNumber();
            if (currentBlock > lastBlock) {
                const events = await contract.queryFilter(myWalletFilter, lastBlock + 1, currentBlock);
                
                for (const event of events) {
                    const from = event.args[0];
                    const amount = event.args[2];
                    const formattedAmount = ethers.formatUnits(amount, decimals);
                    
                    if (parseFloat(formattedAmount) > 0) {
                        const txLink = `${explorerUrl}${event.transactionHash}`;
                        sendDiscordAlert(client, formattedAmount, networkName, from, txLink);
                    }
                }
                lastBlock = currentBlock;
            }
        } catch (err) {
            // Ignore API timeouts
        }
        setTimeout(poll, 15000);
    }
    setTimeout(poll, 15000);
}

// ==========================================
// 📢 DISCORD ALERT SENDER & DATA SAVER
// ==========================================
async function sendDiscordAlert(client, amount, network, sender, txLink) {
    // 🔥 DATA SAVER: Update Daily Stats
    if (dailyStats[network] !== undefined) {
        dailyStats[network] += parseFloat(amount);
    }

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
// 🚀 MASTER EXPORT FUNCTION & CRON JOB
// ==========================================
module.exports = function startPaymentTrackers(client) {
    console.log("🏦 Initializing Anti-Freeze Crypto Payment Trackers...");

    // 🔗 TRC20 Tracker
    setTimeout(() => trackTRC20(client), 2000);
    
    // 🔗 USDT Trackers (EVM)
    trackEVM(client, 'https://ethereum-rpc.publicnode.com', '0xdAC17F958D2ee523a2206206994597C13D831ec7', 'USDT ERC20', 6, 'https://etherscan.io/tx/');
    trackEVM(client, 'https://bsc-rpc.publicnode.com', '0x55d398326f99059fF775485246999027B3197955', 'USDT BEP20', 18, 'https://bscscan.com/tx/');
    trackEVM(client, 'https://arb1.arbitrum.io/rpc', '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', 'USDT Arbitrum', 6, 'https://arbiscan.io/tx/');

    // 🪙 USDC Trackers (NEW)
    trackEVM(client, 'https://ethereum-rpc.publicnode.com', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 'USDC ERC20', 6, 'https://etherscan.io/tx/');
    trackEVM(client, 'https://bsc-rpc.publicnode.com', '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', 'USDC BEP20', 18, 'https://bscscan.com/tx/');

    // ==========================================
    // 🕛 CRON JOB: AUTOMATIC 12:00 AM (MIDNIGHT) REPORT
    // ==========================================
    cron.schedule('0 0 * * *', async () => {
        try {
            const reportChannel = client.channels.cache.get(REPORT_CHANNEL_ID);
            if (!reportChannel) return;

            const totalUSDT = dailyStats['USDT TRC20 (Tron)'] + dailyStats['USDT ERC20'] + dailyStats['USDT BEP20'] + dailyStats['USDT Arbitrum'];
            const totalUSDC = dailyStats['USDC ERC20'] + dailyStats['USDC BEP20'];
            const grandTotal = totalUSDT + totalUSDC;

            const reportEmbed = new EmbedBuilder()
                .setTitle('📊 24-Hour Vault Deposit Audit')
                .setColor('#f1c40f')
                .setDescription('Midnight Settlement Report: Summary of all crypto deposits received in the Professor Network Vault in the last 24 hours.')
                .addFields(
                    { name: '🟢 USDT DEPOSITS', value: `\`\`\`yaml\nTRC20    : $${dailyStats['USDT TRC20 (Tron)'].toFixed(2)}\nERC20    : $${dailyStats['USDT ERC20'].toFixed(2)}\nBEP20    : $${dailyStats['USDT BEP20'].toFixed(2)}\nArbitrum : $${dailyStats['USDT Arbitrum'].toFixed(2)}\n-----------------\nTotal    : $${totalUSDT.toFixed(2)}\n\`\`\``, inline: false },
                    { name: '🔵 USDC DEPOSITS', value: `\`\`\`yaml\nERC20    : $${dailyStats['USDC ERC20'].toFixed(2)}\nBEP20    : $${dailyStats['USDC BEP20'].toFixed(2)}\n-----------------\nTotal    : $${totalUSDC.toFixed(2)}\n\`\`\``, inline: false },
                    { name: '💰 GRAND TOTAL (24H)', value: `**$${grandTotal.toFixed(2)}**`, inline: false }
                )
                .setTimestamp()
                .setFooter({ text: 'Professor Network - Automated Accounting System', iconURL: client.user.displayAvatarURL() });

            await reportChannel.send({ content: '<@1336703883711479896> 🔔 **Midnight Deposit Report Generated!**', embeds: [reportEmbed] });

            // 🔄 Reset counters to 0 for the next day
            for (let key in dailyStats) {
                dailyStats[key] = 0;
            }
            console.log("✅ Daily report sent and stats reset to 0!");

        } catch (err) {
            console.error("Daily Report Error:", err);
        }
    }, {
        scheduled: true,
        timezone: "Asia/Kolkata" 
    });
};