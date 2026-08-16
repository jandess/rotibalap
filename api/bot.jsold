process.env.NTBA_FIX_319 = 1;
const TelegramBot = require('node-telegram-bot-api');
const data = require('../data.json'); // Mengambil data json

const token = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(token);

// Menyimpan pesanan sementara di memori
let userOrders = {};

export default async function handler(req, res) {
  if (req.method === 'POST') {
    const update = req.body;
    
    // 1. Menangani perintah /pesan
    if (update.message && update.message.text === '/pesan') {
      const chatId = update.message.chat.id;
      // Reset keranjang saat mulai baru
      userOrders[chatId] = { items: [], total: 0, pkg: null, variant: null, date: null, time: null };
      
      // Membaca menu dari data.json menjadi tombol
      let keyboard = data.products.map(p => ([{ text: `${p.name} - Rp ${p.price.toLocaleString('id-ID')}`, callback_data: `add_${p.id}` }]));
      keyboard.push([{ text: "➡️ Lanjut (Pilih Kemasan)", callback_data: "lanjut_kemasan" }]);
      
      await bot.sendMessage(chatId, "Silakan pilih menu kue yang ingin dipesan (klik berkali-kali untuk tambah):", {
        reply_markup: { inline_keyboard: keyboard }
      });
    }
    
    // 2. Menangani Klik Tombol
    if (update.callback_query) {
      const query = update.callback_query;
      const chatId = query.message.chat.id;
      const action = query.data;
      
      if (!userOrders[chatId]) Object.assign(userOrders, { [chatId]: { items: [], total: 0 } });
      const order = userOrders[chatId];

      // A. Menambah Produk
      if (action.startsWith('add_')) {
        const id = parseInt(action.split('_')[1]);
        const product = data.products.find(p => p.id === id);
        if (product) {
          order.items.push(product);
          order.total += product.price;
          await bot.answerCallbackQuery(query.id, { text: `✅ ${product.name} ditambahkan! Total sementera: Rp ${order.total.toLocaleString('id-ID')}` });
        }
      } 
      // B. Lanjut ke Kemasan
      else if (action === 'lanjut_kemasan') {
        let keyboard = data.packagingTypes.map(t => ([{ text: `${t.id_tipe} (+Rp ${t.harga_tambahan.toLocaleString('id-ID')})`, callback_data: `pack_${t.id_tipe}` }]));
        await bot.editMessageText("Pilih tipe kemasan:", {
          chat_id: chatId, message_id: query.message.message_id,
          reply_markup: { inline_keyboard: keyboard }
        });
      }
      // C. Memilih Kemasan & Lanjut ke Varian
      else if (action.startsWith('pack_')) {
        const type = action.split('_')[1];
        const pkgInfo = data.packagingTypes.find(t => t.id_tipe === type);
        order.pkg = pkgInfo;
        order.total += pkgInfo.harga_tambahan;

        const variants = data.packagingVariants.filter(v => v.id_tipe === type);
        let keyboard = variants.map(v => ([{ text: v.name, callback_data: `var_${v.id_varian}` }]));
        
        await bot.editMessageText(`Kemasan ${type} dipilih. Sekarang pilih warnanya:`, {
          chat_id: chatId, message_id: query.message.message_id,
          reply_markup: { inline_keyboard: keyboard }
        });
      }
      // D. Memilih Varian & Lanjut ke Tanggal
      else if (action.startsWith('var_')) {
        const varId = action.split('_')[1];
        order.variant = data.packagingVariants.find(v => v.id_varian === varId);

        // Simulasi tombol kalender sederhana
        let keyboard = [
          [{ text: "19 September 2026", callback_data: "date_19_Sep_2026" }]
        ];
        await bot.editMessageText("Pilih Tanggal Pengambilan:", {
          chat_id: chatId, message_id: query.message.message_id,
          reply_markup: { inline_keyboard: keyboard }
        });
      }
      // E. Memilih Tanggal & Lanjut ke Jam
      else if (action.startsWith('date_')) {
        order.date = "Sabtu, 19 September 2026"; 
        
        let keyboard = [[{ text: "06:00 WIB", callback_data: "time_06:00" }]];
        await bot.editMessageText("Pilih Jam Pengambilan:", {
          chat_id: chatId, message_id: query.message.message_id,
          reply_markup: { inline_keyboard: keyboard }
        });
      }
      // F. Memilih Jam & Selesai
      else if (action.startsWith('time_')) {
        order.time = "06:00";
        let keyboard = [[{ text: "✅ Konfirmasi & Cetak Invoice", callback_data: "checkout" }]];
        await bot.editMessageText("Waktu telah dipilih. Lanjut ke ringkasan pesanan?", {
          chat_id: chatId, message_id: query.message.message_id,
          reply_markup: { inline_keyboard: keyboard }
        });
      }
      // G. Tampilkan Invoice Akhir
      else if (action === 'checkout') {
        let detailTeks = "";
        
        // Rekap kue yang di klik
        order.items.forEach(item => {
          detailTeks += `- ${item.name} (1x): Rp ${item.price.toLocaleString('id-ID')}\n`;
        });
        
        // Rekap kemasan
        if (order.pkg) {
           detailTeks += `- Kemasan ${order.pkg.id_tipe} (${order.variant ? order.variant.name : ''}): Rp ${order.pkg.harga_tambahan.toLocaleString('id-ID')}\n`;
        }

        // Membuat ID Invoice Acak
        const invoiceID = "DJD" + Math.random().toString(36).substring(2, 8).toUpperCase();

        const invoiceMsg = `*Halo, saya ingin memesan kue dari DJANDES*\n\n` +
                           `*No. Invoice:* ${invoiceID}\n\n` +
                           `*Data Pemesan:*\n*Nama:* ${query.from.first_name}\n` +
                           `*Tanggal Pengambilan:* ${order.date}\n` +
                           `*Jam Pengambilan:* ${order.time}\n\n` +
                           `*Detail Pesanan:*\n${detailTeks}\n` +
                           `*Total: Rp ${order.total.toLocaleString('id-ID')}*\n\n` +
                           `*Silakan konfirmasi ketersediaan dan total pembayaran. Terima kasih!*`;

        await bot.editMessageText(invoiceMsg, {
          chat_id: chatId, message_id: query.message.message_id,
          parse_mode: 'Markdown'
        });
        
        // Kosongkan keranjang setelah selesai
        delete userOrders[chatId];
      }
    }
    res.status(200).send('OK');
  } else {
    // Pesan jika web dibuka lewat browser biasa
    res.status(200).send('Server Bot DJANDES Sedang Berjalan Sempurna!');
  }
}
