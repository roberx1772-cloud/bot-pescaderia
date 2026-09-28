 const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const fs = require('fs');
require('dotenv').config();

const startupTime = Date.now() / 1000;

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './data' }),
    puppeteer: {
        headless: true, // CAMBIAR A true CUANDO SUBAS AL VPS
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

const ultimosSaludos = {};
let estadoEnvio = {
    corriendo: false,
    enviados: 0,
    total: 0,
    ultimoInicio: null,
    abortar: false
};

// --- CONFIGURACIÓN ---
// Ahora lee el número desde el archivo .env
const NUMERO_PERSONAL_CLIENTE = process.env.NUMERO_PERSONAL_CLIENTE || '5490000000000@c.us';
// --- FUNCIONES DE APOYO ---

function esHorarioComercial() {
    const ahora = new Date(new Date().toLocaleString("en-US", {timeZone: "America/Argentina/Buenos_Aires"}));
    const dia = ahora.getDay(); 
    const horaActual = ahora.getHours() + (ahora.getMinutes() / 60);
    
    if (dia === 0) return false; 
    return (horaActual >= 9 && horaActual < 13) || (horaActual >= 17 && horaActual < 20.5);
}

async function iniciarEnvioMasivo(media = null) {
    const pathClientes = './clientes.json'; // RUTA CORREGIDA
    const pathMsg = './mensaje.txt';
    
    if (!fs.existsSync(pathClientes) || !fs.existsSync(pathMsg)) {
        console.log("❌ Error: Faltan archivos.");
        return;
    }

    const mensajeBase = fs.readFileSync(pathMsg, 'utf-8');
    let clientes = JSON.parse(fs.readFileSync(pathClientes, 'utf-8'));

    estadoEnvio.corriendo = true;
    estadoEnvio.enviados = 0;
    estadoEnvio.total = clientes.filter(c => c.estado === 'pendiente').length;
    estadoEnvio.ultimoInicio = new Date().toLocaleTimeString();

    console.log(`🚀 Iniciando envío a ${estadoEnvio.total} contactos...`);

    for (let i = 0; i < clientes.length; i++) {
        if (estadoEnvio.abortar) break; // Lógica para detener el envío

        if (clientes[i].estado === 'pendiente') {
            if (esHorarioComercial()) {
                try {
                    const chatId = `${clientes[i].telefono}@c.us`;
                    
                    if (media) {
                        await client.sendMessage(chatId, media, { caption: mensajeBase });
                    } else {
                        await client.sendMessage(chatId, mensajeBase);
                    }
                    
                    clientes[i].estado = 'enviado';
                    estadoEnvio.enviados++;
                    
                    fs.writeFileSync(pathClientes, JSON.stringify(clientes, null, 2));
                    console.log(`✅ [${estadoEnvio.enviados}/${estadoEnvio.total}] Enviado a ${clientes[i].nombre}`);
                    
                    await new Promise(r => setTimeout(r, clientes[i].delay * 1000));
                } catch (e) {
                    console.error(`❌ Error con ${clientes[i].nombre}:`, e.message);
                }
            } else {
                console.log("⏸️ Pausa por horario comercial. Reintentando en 10 min...");
                estadoEnvio.corriendo = false;
                await new Promise(r => setTimeout(r, 600000)); 
                estadoEnvio.corriendo = true;
                i--; 
            }
        }
    }
    estadoEnvio.corriendo = false;
    estadoEnvio.abortar = false;
    console.log("🏁 Fin del proceso.");
}

// --- EVENTOS ---

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    QRCode.toFile('./codigo-qr.png', qr, (err) => {
        if (err) console.log("Error al guardar QR PNG:", err);
    });
});

client.on('ready', () => {
    console.log('¡Bot de Pescadería El Buen Pique activo y conectado!');
});

client.on('message_create', async (msg) => {
    if (msg.timestamp < startupTime) return;

    const cuerpo = msg.body.trim();
    const cuerpoLow = cuerpo.toLowerCase();
    const chatID = msg.from;

    const esDuenio = (chatID === NUMERO_PERSONAL_CLIENTE);
    const esDesdeElBot = msg.fromMe;

    if (esDuenio || esDesdeElBot) {
        
        if (cuerpoLow === '#ayuda') {
            const menu = `*Manual de Comandos* 🤖\n\n` +
                         `#ver -> Ver mensaje actual\n` +
                         `#mensaje [texto] -> Cambiar oferta\n` +
                         `#anotar [numero] -> Agregar cliente (549...)\n` +
                         `#reparto -> Iniciar masivo (Solo texto)\n` +
                         `#reparto-foto [dia] -> Foto + Texto\n` +
                         `#parar -> Detener envío urgente 🛑\n` +
                         `#reset -> Preparar lista para nuevo envío\n` +
                         `#status -> Ver progreso\n\n` +
                         `_Días para fotos: miercoles, jueves, viernes_`;
            await client.sendMessage(chatID, menu);
            return;
        }

        if (cuerpoLow === '#ver') {
            const actual = fs.readFileSync('./mensaje.txt', 'utf-8');
            await client.sendMessage(chatID, `📝 *Oferta actual:* \n\n${actual}`);
            return;
        }

        if (cuerpoLow.startsWith('#mensaje')) {
            const nuevoTxt = cuerpo.replace(/#mensaje/i, '').trim();
            if (nuevoTxt.length > 0) {
                fs.writeFileSync('./mensaje.txt', nuevoTxt);
                await client.sendMessage(chatID, "✅ *Sistema:* Oferta guardada. Usá *#ver* para revisar.");
            } else {
                await client.sendMessage(chatID, "❌ *Error:* Escribí el texto después del hashtag.");
            }
            return;
        }

        if (cuerpoLow.startsWith('#anotar')) {
            const num = cuerpo.split(' ')[1];
            if (!num) return client.sendMessage(chatID, "❌ Error: Usá #anotar 549...");
            
            let clientes = JSON.parse(fs.readFileSync('./clientes.json', 'utf-8')); // RUTA CORREGIDA
            const nuevoId = (clientes.length + 1).toString().padStart(3, '0');
            const randomDelay = Math.floor(Math.random() * (220 - 150 + 1) + 150);

            clientes.push({
                nombre: `cliente${nuevoId}`,
                telefono: num.trim(),
                estado: "pendiente",
                delay: randomDelay
            });

            fs.writeFileSync('./clientes.json', JSON.stringify(clientes, null, 2)); // RUTA CORREGIDA
            await client.sendMessage(chatID, `✅ Guardado como cliente${nuevoId} (Delay: ${randomDelay}s)`);
            return;
        }

        if (cuerpoLow === '#reparto') {
            if (estadoEnvio.corriendo) {
                await client.sendMessage(chatID, "⚠️ *Sistema:* Ya hay un envío en curso.");
            } else {
                estadoEnvio.abortar = false; 
                await client.sendMessage(chatID, "🚀 *Sistema:* Iniciando reparto masivo de TEXTO...");
                iniciarEnvioMasivo();
            }
            return;
        }

        if (cuerpoLow.startsWith('#reparto-foto')) {
            const dia = cuerpo.split(' ')[1]?.toLowerCase();
            const rutaFoto = `./fotos/${dia}.jpg`;

            if (estadoEnvio.corriendo) {
                await client.sendMessage(chatID, "⚠️ *Sistema:* Ya hay un envío en curso.");
            } else if (dia && fs.existsSync(rutaFoto)) {
                estadoEnvio.abortar = false;
                await client.sendMessage(chatID, `🚀 *Sistema:* Iniciando reparto de FOTO (${dia}) + TEXTO...`);
                const media = MessageMedia.fromFilePath(rutaFoto);
                iniciarEnvioMasivo(media);
            } else {
                await client.sendMessage(chatID, "❌ *Error:* No encuentro la foto o no indicaste el día.");
            }
            return;
        }

        if (cuerpoLow === '#parar') {
            if (estadoEnvio.corriendo) {
                estadoEnvio.abortar = true;
                await client.sendMessage(chatID, "🛑 *Sistema:* Deteniendo el proceso...");
            } else {
                await client.sendMessage(chatID, "⚠️ *Sistema:* No hay ningún envío activo.");
            }
            return;
        }

        if (cuerpoLow === '#reset') {
            let clientes = JSON.parse(fs.readFileSync('./clientes.json', 'utf-8')); // RUTA CORREGIDA
            clientes = clientes.map(c => ({ ...c, estado: 'pendiente' }));
            fs.writeFileSync('./clientes.json', JSON.stringify(clientes, null, 2)); // RUTA CORREGIDA
            await client.sendMessage(chatID, "🔄 *Sistema:* Lista de clientes reseteada.");
            return;
        }

        if (cuerpoLow === '#status') {
            const reporte = estadoEnvio.corriendo 
                ? `⏳ *Estado:* Enviando...\n📊 *Progreso:* ${estadoEnvio.enviados}/${estadoEnvio.total}\n🕒 *Inició:* ${estadoEnvio.ultimoInicio}`
                : `✅ *Estado:* En espera o finalizado.`;
            await client.sendMessage(chatID, reporte);
            return;
        }
    }

    if (msg.fromMe || esDuenio) return; 
    if (chatID.includes('@g.us') || chatID === 'status@broadcast') return;

    const ahoraMs = Date.now();
    if (ultimosSaludos[chatID] && (ahoraMs - ultimosSaludos[chatID] < 7200000)) return;

    try {
        await new Promise(r => setTimeout(r, 1200)); 
        const textoBienvenida = "Gracias por comunicarte con PESCADERIA EL BUEN PIQUE ¿Cómo podemos ayudarte?\nNuestros horarios de atención:\nDe Lunes a sábado de 09 a 13hs y de 17 a 20:30hs";
        const textoCerrado = "Gracias por tu mensaje. En este momento no podemos responder, pero lo haremos lo antes posible.\nNuestros horarios son:\nDe Lunes a sábado de 09 a 13hs y de 17 a 20:30hs";

        const mensajeAEnviar = esHorarioComercial() ? textoBienvenida : textoCerrado;

        // Mandamos el mensaje directo, el try/catch ya se encarga si algo falla
        await client.sendMessage(chatID, mensajeAEnviar);
        
        ultimosSaludos[chatID] = ahoraMs;
        console.log(`🤖 Respuesta automática enviada a: ${chatID}`);

    } catch (e) {
        console.error("❌ Error en auto-respuesta:", e.message);
    }
});

client.initialize();