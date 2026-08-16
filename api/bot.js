process.env.NTBA_FIX_319 = 1;
const TelegramBot = require('node-telegram-bot-api');
const data = require('../data.json'); // Pastikan nama file data kamu adalah data.json

const token = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(token);

// Objek untuk menyimpan sesi pesanan pengguna
let userOrders = {};

const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

export default async function handler(req, res) {
  if (req.method === 'POST') {
    const update = req.body;

    try {
      // 1. Menangani perintah /pesan
      if (update.message && update.message.text === '/pesan') {
        const chatId = update.message.chat.id;
        
        // Buat sesi keranjang baru
        userOrders[chatId] = { items: {}, pkg: null, variant: null, year: null, month: null, date: null, hour: null };
        
        await bot.sendMessage(chatId, "Silakan pilih menu kue yang ingin dipesan (Klik lagi untuk menambah jumlah):", {
          reply_markup: getMenuKeyboard(chatId)
        });
      }

      // 2. Menangani Klik Tombol
      if (update.callback_query) {
        const query = update.callback_query;
        const chatId = query.message.chat.id;
        const action = query.data;

        // Cegah error jika Vercel tertidur dan memori hilang
        if (!userOrders[chatId]) {
            userOrders[chatId] = { items: {}, pkg: null, variant: null, year: null, month: null, date: null, hour: null };
        }
        
        const order = userOrders[chatId];

        // --- A. TOMBOL MENU & KUANTITAS ---
        if (action.startsWith('add_')) {
          const id = action.split('_')[1];
          const product = data.products.find(p => p.id.toString() === id);
          
          if (product) {
            if (!order.items[id]) {
                order.items[id] = { product: product, qty: 1 };
            } else {
                order.items[id].qty += 1;
            }
            
            // Perbarui tombol secara real-time
            await bot.editMessageReplyMarkup(getMenuKeyboard(chatId), {
                chat_id: chatId,
                message_id: query.message.message_id
            });
          }
        } 
        
        // --- B. RESET PESANAN ---
        else if (action === 'reset') {
            order.items = {};
            await bot.editMessageReplyMarkup(getMenuKeyboard(chatId), {
                chat_id: chatId,
                message_id: query.message.message_id
            });
            await bot.answerCallbackQuery(query.id, { text: "Pesanan di-reset!" });
        }

        // --- C. LANJUT KE KEMASAN ---
        else if (action === 'next_pkg') {
          if (Object.keys(order.items).length === 0) {
              return bot.answerCallbackQuery(query.id, { text: "⚠️ Silakan pilih minimal 1 kue terlebih dahulu!", show_alert: true });
          }
          
          let keyboard = data.packagingTypes.map(t => ([{ text: `${t.id_tipe} (+Rp ${t.harga_tambahan.toLocaleString('id-ID')})`, callback_data: `pkg_${t.id_tipe}` }]));
          await bot.editMessageText("Pilih tipe kemasan:", {
            chat_id: chatId, message_id: query.message.message_id,
            reply_markup: { inline_keyboard: keyboard }
          });
        }

        // --- D. PILIH KEMASAN -> LANJUT VARIAN ---
        else if (action.startsWith('pkg_')) {
          const type = action.split('_')[1];
          order.pkg = data.packagingTypes.find(t => t.id_tipe === type);

          const variants = data.packagingVariants.filter(v => v.id_tipe === type);
          let keyboard = variants.map(v => ([{ text: v.name, callback_data: `var_${v.id_varian}` }]));
          
          await bot.editMessageText(`Kemasan *${type}* dipilih. Sekarang pilih varian warnanya:`, {
            chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
          });
        }

        // --- E. PILIH VARIAN -> LANJUT TAHUN ---
        else if (action.startsWith('var_')) {
          const varId = action.split('_')[1];
          order.variant = data.packagingVariants.find(v => v.id_varian === varId);

          const currentYear = new Date().getFullYear();
          let keyboard = [];
          for (let i = 0; i < 5; i++) {
              keyboard.push([{ text: `Tahun ${currentYear + i}`, callback_data: `yr_${currentYear + i}` }]);
          }

          await bot.editMessageText("Pilih **Tahun** Pengambilan:", {
            chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
          });
        }

        // --- F. PILIH TAHUN -> LANJUT BULAN ---
        else if (action.startsWith('yr_')) {
            order.year = parseInt(action.split('_')[1]);
            
            let keyboard = [];
            let row = [];
            for (let i = 0; i < 12; i++) {
                row.push({ text: MONTHS[i], callback_data: `mo_${i + 1}` });
                if (row.length === 3 || i === 11) { // 3 tombol per baris
                    keyboard.push(row);
                    row = [];
                }
            }

            await bot.editMessageText(`Tahun *${order.year}*. Pilih **Bulan** Pengambilan:`, {
                chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });
        }

        // --- G. PILIH BULAN -> LANJUT TANGGAL ---
        else if (action.startsWith('mo_')) {
            order.month = parseInt(action.split('_')[1]);
            
            // Menghitung jumlah hari pada bulan dan tahun tersebut
            const daysInMonth = new Date(order.year, order.month, 0).getDate();
            
            let keyboard = [];
            let row = [];
            for (let i = 1; i <= daysInMonth; i++) {
                row.push({ text: `${i}`, callback_data: `dt_${i}` });
                if (row.length === 6 || i === daysInMonth) { // 6 tombol per baris
                    keyboard.push(row);
                    row = [];
                }
            }

            await bot.editMessageText(`Bulan *${MONTHS[order.month - 1]} ${order.year}*. Pilih **Tanggal**:`, {
                chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });
        }

        // --- H. PILIH TANGGAL -> LANJUT JAM ---
        else if (action.startsWith('dt_')) {
            order.date = parseInt(action.split('_')[1]);
            
            let keyboard = [];
            let row = [];
            for (let i = 6; i <= 21; i++) { // Menampilkan jam 06:00 sampai 21:00
                let hrStr = i.toString().padStart(2, '0');
                row.push({ text: `${hrStr}:00`, callback_data: `hr_${hrStr}:00` });
                if (row.length === 4 || i === 21) { // 4 tombol per baris
                    keyboard.push(row);
                    row = [];
                }
            }

            await bot.editMessageText(`Tanggal *${order.date} ${MONTHS[order.month - 1]} ${order.year}*. Pilih **Jam** Pengambilan:`, {
                chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });
        }

        // --- I. PILIH JAM -> CHECKOUT ---
        else if (action.startsWith('hr_')) {
            order.hour = action.split('_')[1];
            
            let keyboard = [[{ text: "✅ Selesai & Cetak Invoice", callback_data: "checkout" }]];
            await bot.editMessageText(`Waktu dipilih: **${order.hour} WIB**. Lanjut cetak pesanan?`, {
                chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });
        }

        // --- J. TAMPILKAN INVOICE AKHIR ---
        else if (action === 'checkout') {
          let detailTeks = "";
          let totalHarga = 0;
          
          // Rekap produk
          for (let id in order.items) {
              const item = order.items[id];
              const subtotal = item.product.price * item.qty;
              detailTeks += `- ${item.product.name} (${item.qty}x): Rp ${subtotal.toLocaleString('id-ID')}\n`;
              totalHarga += subtotal;
          }
          
          // Rekap kemasan
          if (order.pkg) {
             detailTeks += `- Kemasan ${order.pkg.id_tipe} (${order.variant ? order.variant.name : ''}): Rp ${order.pkg.harga_tambahan.toLocaleString('id-ID')}\n`;
             totalHarga += order.pkg.harga_tambahan;
          }

          // ID Invoice Acak DJD...
          const invoiceID = "DJD" + Math.random().toString(36).substring(2, 8).toUpperCase();

          const invoiceMsg = `*Halo, saya ingin memesan kue dari DJANDES*\n\n` +
                             `*No. Invoice:* ${invoiceID}\n\n` +
                             `*Data Pemesan:*\n` + // Nama dihilangkan
                             `*Tanggal Pengambilan:* ${order.date} ${MONTHS[order.month - 1]} ${order.year}\n` +
                             `*Jam Pengambilan:* ${order.hour}\n\n` +
                             `*Detail Pesanan:*\n${detailTeks}\n` +
                             `*Total: Rp ${totalHarga.toLocaleString('id-ID')}*\n\n` +
                             `*Silakan konfirmasi ketersediaan dan total pembayaran. Terima kasih!*`;

          await bot.editMessageText(invoiceMsg, {
            chat_id: chatId, message_id: query.message.message_id,
            parse_mode: 'Markdown'
          });
          
          // Kosongkan keranjang setelah selesai
          delete userOrders[chatId];
        }
      }
    } catch (error) {
        console.error("Bot Error:", error);
    }
    
    res.status(200).send('OK');
  } else {
    res.status(200).send('Server Bot DJANDES Sedang Berjalan Sempurna!');
  }
}

// Fungsi pembantu untuk membuat tombol menu yang dinamis
function getMenuKeyboard(chatId) {
    const order = userOrders[chatId];
    let keyboard = data.products.map(p => {
        const qty = order?.items[p.id]?.qty || 0;
        const textBtn = qty > 0 ? `✅ ${p.name} (${qty}x) - Rp ${p.price.toLocaleString('id-ID')}` : `${p.name} - Rp ${p.price.toLocaleString('id-ID')}`;
        return [{ text: textBtn, callback_data: `add_${p.id}` }];
    });
    
    keyboard.push([{ text: "🔄 Reset Pesanan", callback_data: "reset" }]);
    keyboard.push([{ text: "➡️ Lanjut (Pilih Kemasan)", callback_data: "next_pkg" }]);
    
    return { inline_keyboard: keyboard };
}
