process.env.NTBA_FIX_319 = 1;
const TelegramBot = require('node-telegram-bot-api');
const data = require('../data.json'); 

const token = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(token);

// Menyimpan sesi pesanan
let userOrders = {};
const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

function getTotalQty(order) {
    return Object.values(order.items).reduce((acc, item) => acc + item.qty, 0);
}

export default async function handler(req, res) {
  if (req.method === 'POST') {
    const update = req.body;

    try {
      // ==========================================
      // 1. MENANGANI PERINTAH TEKS & CUSTOM KEYBOARD
      // ==========================================
      if (update.message && update.message.text) {
        const text = update.message.text;
        const chatId = update.message.chat.id;

        if (text === '/start') {
            const replyKeyboard = {
                keyboard: [[{ text: "🛍️ Pesan Sekarang" }, { text: "📋 Cek Daftar Harga" }]],
                resize_keyboard: true,
                is_persistent: true
            };
            await bot.sendMessage(chatId, "Selamat datang di DJANDES! Silakan gunakan tombol di bawah untuk memesan atau mengecek daftar harga.", { 
                reply_markup: replyKeyboard 
            });
            return res.status(200).send('OK');
        }

        if (text === '📋 Cek Daftar Harga') {
            const parcels = data.products.filter(p => p.name.toLowerCase().includes('parcel'));
            const kues = data.products.filter(p => !p.name.toLowerCase().includes('parcel'));
            
            let msgText = `*📋 DAFTAR HARGA MENU DJANDES*\n\n`;
            
            msgText += `*📦 Parcel & Hantaran:*\n`;
            parcels.forEach(p => { msgText += `🔸 ${p.name} : Rp ${p.price.toLocaleString('id-ID')}\n`; });
            
            msgText += `\n*🥧 Kue Tradisional & Modern:*\n`;
            kues.forEach(p => { msgText += `🔸 ${p.name} : Rp ${p.price.toLocaleString('id-ID')}\n`; });
            
            msgText += `\n*🎀 Harga Kemasan (Box):*\n`;
            data.packagingTypes.forEach(t => { msgText += `🔸 ${t.id_tipe} : ${t.harga_tambahan === 0 ? 'Gratis' : '+Rp ' + t.harga_tambahan.toLocaleString('id-ID') + ' (per item)'}\n`; });

            await bot.sendMessage(chatId, msgText, { parse_mode: 'Markdown' });
            return res.status(200).send('OK');
        }

        if (text === '/pesan' || text === '🛍️ Pesan Sekarang') {
            userOrders[chatId] = { items: {}, pkg: null, variant: null, year: null, month: null, date: null, hour: null };
            await bot.sendMessage(chatId, "Silakan pilih menu kue yang ingin dipesan:", {
                reply_markup: getMenuKeyboard(chatId)
            });
            return res.status(200).send('OK');
        }
      }

      // ==========================================
      // 2. MENANGANI KLIK TOMBOL INLINE
      // ==========================================
      if (update.callback_query) {
        const query = update.callback_query;
        const chatId = query.message.chat.id;
        const action = query.data;

        // Respon cepat untuk tombol netral (yang tidak punya aksi)
        if (action === 'noop') {
            await bot.answerCallbackQuery(query.id);
            return res.status(200).send('OK');
        }

        if (!userOrders[chatId]) {
            userOrders[chatId] = { items: {}, pkg: null, variant: null, year: null, month: null, date: null, hour: null };
        }
        const order = userOrders[chatId];
        const currentQty = getTotalQty(order);

        // --- A. KEMBALI KE MENU ---
        if (action === 'back_menu') {
            await bot.editMessageText("Silakan pilih menu kue yang ingin dipesan:", {
                chat_id: chatId, message_id: query.message.message_id,
                reply_markup: getMenuKeyboard(chatId)
            });
            await bot.answerCallbackQuery(query.id);
        } 
        
        // --- B. MENU: TAMBAH, KURANGI, RESET ---
        else if (action.startsWith('add_') || action.startsWith('min_') || action === 'reset') {
          if (action === 'reset') {
              if (Object.keys(order.items).length === 0) {
                  await bot.answerCallbackQuery(query.id, { text: "⚠️ Keranjang Anda sudah kosong!", show_alert: true });
                  return res.status(200).send('OK'); // Mencegah bot loading terus
              }
              order.items = {};
          }
          else if (action.startsWith('add_')) {
              const id = action.split('_')[1];
              const product = data.products.find(p => p.id.toString() === id);
              if (product) {
                  if (!order.items[id]) order.items[id] = { product: product, qty: 1 };
                  else order.items[id].qty += 1;
              }
          } 
          else if (action.startsWith('min_')) {
              const id = action.split('_')[1];
              if (order.items[id]) {
                  order.items[id].qty -= 1;
                  if (order.items[id].qty <= 0) delete order.items[id];
              }
          }
          
          try {
              await bot.editMessageReplyMarkup(getMenuKeyboard(chatId), { chat_id: chatId, message_id: query.message.message_id });
          } catch (e) {
              // Abaikan error jika Telegram menganggap tidak ada perubahan tampilan
          }
          await bot.answerCallbackQuery(query.id);
        }

        // --- C. LANJUT KEMASAN (DENGAN PROTEKSI KERANJANG KOSONG) ---
        else if (action === 'next_pkg' || action === 'back_pkg') {
          if (currentQty === 0) {
              await bot.answerCallbackQuery(query.id, { text: "⚠️ Silakan pilih minimal 1 kue terlebih dahulu!", show_alert: true });
              return res.status(200).send('OK'); // Mencegah bot loading terus
          }
          
          let keyboard = data.packagingTypes.map(t => ([{ 
              text: `${t.id_tipe} (+Rp ${(t.harga_tambahan * currentQty).toLocaleString('id-ID')})`, 
              callback_data: `pkg_${t.id_tipe}` 
          }]));
          keyboard.push([{ text: "⬅️ Kembali ke Menu Utama", callback_data: "back_menu" }]);
          
          await bot.editMessageText(`Anda memesan **${currentQty} porsi** kue.\nPilih tipe kemasan untuk semua pesanan Anda:`, {
            chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
          });
          await bot.answerCallbackQuery(query.id);
        }

        // --- D. VARIAN KEMASAN ---
        else if (action.startsWith('pkg_') || action === 'back_var') {
          if (action.startsWith('pkg_')) order.pkg = data.packagingTypes.find(t => t.id_tipe === action.split('_')[1]);

          const variants = data.packagingVariants.filter(v => v.id_tipe === order.pkg.id_tipe);
          let keyboard = variants.map(v => ([{ text: v.name, callback_data: `var_${v.id_varian}` }]));
          keyboard.push([{ text: "⬅️ Kembali ke Tipe Kemasan", callback_data: "back_pkg" }]);
          
          await bot.editMessageText(`Kemasan *${order.pkg.id_tipe}* dipilih. Sekarang pilih warnanya:`, {
            chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
          });
          await bot.answerCallbackQuery(query.id);
        }

        // --- E. TAHUN PENGAMBILAN ---
        else if (action.startsWith('var_') || action === 'back_yr') {
          if (action.startsWith('var_')) order.variant = data.packagingVariants.find(v => v.id_varian === action.split('_')[1]);

          const currentYear = new Date().getFullYear();
          let keyboard = [];
          for (let i = 0; i < 5; i++) {
              keyboard.push([{ text: `Tahun ${currentYear + i}`, callback_data: `yr_${currentYear + i}` }]);
          }
          keyboard.push([{ text: "⬅️ Kembali Ubah Warna", callback_data: "back_var" }]);

          await bot.editMessageText("Pilih **Tahun** Pengambilan:", {
            chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
          });
          await bot.answerCallbackQuery(query.id);
        }

        // --- F. BULAN PENGAMBILAN ---
        else if (action.startsWith('yr_') || action === 'back_mo') {
            if (action.startsWith('yr_')) order.year = parseInt(action.split('_')[1]);
            
            let keyboard = [];
            let row = [];
            for (let i = 0; i < 12; i++) {
                row.push({ text: MONTHS[i], callback_data: `mo_${i + 1}` });
                if (row.length === 3 || i === 11) {
                    keyboard.push(row);
                    row = [];
                }
            }
            keyboard.push([{ text: "⬅️ Kembali Ubah Tahun", callback_data: "back_yr" }]);

            await bot.editMessageText(`Tahun *${order.year}*. Pilih **Bulan** Pengambilan:`, {
                chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });
            await bot.answerCallbackQuery(query.id);
        }

        // --- G. TANGGAL PENGAMBILAN ---
        else if (action.startsWith('mo_') || action === 'back_dt') {
            if (action.startsWith('mo_')) order.month = parseInt(action.split('_')[1]);
            
            const daysInMonth = new Date(order.year, order.month, 0).getDate();
            let keyboard = [];
            let row = [];
            for (let i = 1; i <= daysInMonth; i++) {
                row.push({ text: `${i}`, callback_data: `dt_${i}` });
                if (row.length === 6 || i === daysInMonth) {
                    keyboard.push(row);
                    row = [];
                }
            }
            keyboard.push([{ text: "⬅️ Kembali Ubah Bulan", callback_data: "back_mo" }]);

            await bot.editMessageText(`Bulan *${MONTHS[order.month - 1]} ${order.year}*. Pilih **Tanggal**:`, {
                chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });
            await bot.answerCallbackQuery(query.id);
        }

        // --- H. JAM PENGAMBILAN ---
        else if (action.startsWith('dt_') || action === 'back_hr') {
            if (action.startsWith('dt_')) order.date = parseInt(action.split('_')[1]);
            
            let keyboard = [];
            let row = [];
            for (let i = 6; i <= 21; i++) {
                let hrStr = i.toString().padStart(2, '0');
                row.push({ text: `${hrStr}:00`, callback_data: `hr_${hrStr}:00` });
                if (row.length === 4 || i === 21) {
                    keyboard.push(row);
                    row = [];
                }
            }
            keyboard.push([{ text: "⬅️ Kembali Ubah Tanggal", callback_data: "back_dt" }]);

            await bot.editMessageText(`Tanggal *${order.date} ${MONTHS[order.month - 1]} ${order.year}*. Pilih **Jam** Pengambilan:`, {
                chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });
            await bot.answerCallbackQuery(query.id);
        }

        // --- I. REVIEW SEBELUM CETAK ---
        else if (action.startsWith('hr_')) {
            order.hour = action.split('_')[1];
            
            let keyboard = [
                [{ text: "✅ Benar, Selesai & Cetak Invoice", callback_data: "checkout_final" }],
                [{ text: "⬅️ Salah, Kembali Ubah Jam", callback_data: "back_hr" }]
            ];
            await bot.editMessageText(`Waktu dipilih: **${order.hour} WIB**.\n\nJika waktu sudah benar, silakan lanjut mencetak pesanan.`, {
                chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });
            await bot.answerCallbackQuery(query.id);
        }

        // --- J. CETAK INVOICE FINAL ---
        else if (action === 'checkout_final') {
          let detailTeks = "";
          let totalHarga = 0;
          
          for (let id in order.items) {
              const item = order.items[id];
              const subtotal = item.product.price * item.qty;
              detailTeks += `- ${item.product.name} (${item.qty}x): Rp ${subtotal.toLocaleString('id-ID')}\n`;
              totalHarga += subtotal;
          }
          
          if (order.pkg) {
             const pkgTotal = order.pkg.harga_tambahan * currentQty;
             detailTeks += `- Kemasan ${order.pkg.id_tipe} (${order.variant ? order.variant.name : ''}) (${currentQty}x): Rp ${pkgTotal.toLocaleString('id-ID')}\n`;
             totalHarga += pkgTotal;
          }

          const invoiceID = "DJD" + Math.random().toString(36).substring(2, 8).toUpperCase();

          const invoiceMsg = `*Halo, saya ingin memesan kue dari DJANDES*\n\n` +
                             `*No. Invoice:* ${invoiceID}\n\n` +
                             `*Data Pemesan:*\n` +
                             `*Tanggal Pengambilan:* ${order.date} ${MONTHS[order.month - 1]} ${order.year}\n` +
                             `*Jam Pengambilan:* ${order.hour}\n\n` +
                             `*Detail Pesanan:*\n${detailTeks}\n` +
                             `*Total: Rp ${totalHarga.toLocaleString('id-ID')}*\n\n` +
                             `*Silakan konfirmasi ketersediaan dan total pembayaran. Terima kasih!*`;

          await bot.editMessageText(invoiceMsg, {
            chat_id: chatId, message_id: query.message.message_id,
            parse_mode: 'Markdown'
          });
          
          delete userOrders[chatId];
          await bot.answerCallbackQuery(query.id);
        }
      }
    } catch (error) {
        console.error("Bot Error:", error);
    }
    
    // Titik paling krusial: Memastikan webhook selalu diakhiri dengan status 200
    res.status(200).send('OK');
  } else {
    res.status(200).send('Server Bot DJANDES Sedang Berjalan Sempurna!');
  }
}

function getMenuKeyboard(chatId) {
    const order = userOrders[chatId];
    const sortedProducts = [...data.products].sort((a, b) => a.name.localeCompare(b.name));
    
    let keyboard = sortedProducts.map(p => {
        const qty = order?.items[p.id]?.qty || 0;
        
        if (qty === 0) {
            return [{ text: p.name, callback_data: `add_${p.id}` }];
        } else {
            return [
                { text: "➖", callback_data: `min_${p.id}` },
                { text: `✅ ${p.name} (${qty}x)`, callback_data: `noop` },
                { text: "➕", callback_data: `add_${p.id}` }
            ];
        }
    });
    
    keyboard.push([{ text: "🔄 Reset Pesanan", callback_data: "reset" }]);
    keyboard.push([{ text: "➡️ Lanjut (Pilih Kemasan)", callback_data: "next_pkg" }]);
    
    return { inline_keyboard: keyboard };
}
