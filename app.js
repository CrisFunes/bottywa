const { createBot, createProvider, createFlow, addKeyword, EVENTS } = require('@bot-whatsapp/bot')
const BaileysProvider = require('@bot-whatsapp/provider/baileys')
const MockAdapter = require('@bot-whatsapp/database/json')
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const fsPromises = fs.promises;

function getAppPath() {
    return process.pkg ? path.dirname(process.execPath) : __dirname;
}

async function initializeBotConfig() {
    const configPath = path.join(getAppPath(), 'botConfig.json');
    try {
        // Intentar leer el archivo de configuración
        let config = await loadBotConfig();

        // Si no hay instancias, agregar bot-1 como predeterminado
        if (!config.instances || config.instances.length === 0) {
            config = { instances: ['bot-1'] };
            await saveBotConfig(config);
            console.log('botConfig.json initializado con bot-1 predeterminado');
        }

        return config;
    } catch (error) {
        // Si el archivo no existe o está vacío, crear uno nuevo con bot-1
        const defaultConfig = { instances: ['bot-1'] };
        await saveBotConfig(defaultConfig);
        console.log('Nuevo botConfig.json creado con bot-1 predeterminado');
        return defaultConfig;
    }
}

async function loadBotConfig() {
    try {
        const configPath = path.join(getAppPath(), 'botConfig.json');
        const configData = await fsPromises.readFile(configPath, 'utf8');
        return JSON.parse(configData);
    } catch (error) {
        if (error.code === 'ENOENT') {
            // Si el archivo no existe, retornar un objeto vacío
            return { instances: [] };
        }
        throw error;
    }
}

async function saveBotConfig(config) {
    try {
        const configPath = path.join(getAppPath(), 'botConfig.json');
        await fsPromises.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
    } catch (error) {
        console.error('Error saving bot configuration:', error);
        throw error;
    }
}

const QR_DIR = getAppPath();
const APP_PATH = path.join(__dirname);
const WELCOME_MESSAGES_FILE = path.join('welcome-messages.json');


class CustomMockAdapter extends MockAdapter {
    constructor(botName) {
        super({ filename: path.join(`${botName}_db.json`) });
    }
}

async function loadJSONFile(filename) {
    try {
        const data = await fsPromises.readFile(filename, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
}

async function saveJSONFile(filename, data) {
    await fsPromises.writeFile(filename, JSON.stringify(data, null, 2), 'utf8');
}

async function loadWelcomeMessages() {
    return loadJSONFile(WELCOME_MESSAGES_FILE);
}

async function saveWelcomeMessages(messages) {
    await saveJSONFile(WELCOME_MESSAGES_FILE, messages);
}

async function loadContacts(botName) {
    return loadJSONFile(path.join(`${botName}_contacts.json`));
}

async function saveContacts(botName, contacts) {
    await saveJSONFile(path.join(`${botName}_contacts.json`), contacts);
}

async function getRandomWelcomeMessage() {
    const messages = await loadWelcomeMessages();
    return messages[Math.floor(Math.random() * messages.length)] || "Bienvenido!";
}

async function isNewContact(botName, phone) {
    const contacts = await loadContacts(botName);
    return !contacts.some(contact => contact.phone === phone);
}

async function addContact(botName, phone, responseMessage) {
    const contacts = await loadContacts(botName);
    if (!contacts.some(contact => contact.phone === phone)) {
        const now = new Date();
        contacts.push({
            phone,
            date: now.toISOString().split('T')[0],
            time: now.toTimeString().split(' ')[0],
            responseMessage
        });
        await saveContacts(botName, contacts);
    }
}

const createFlowForBot = (botName) => {
    return addKeyword(EVENTS.WELCOME)
    .addAction(
        { delay: Math.floor(Math.random() * (5000 - 3000 + 1)) + 3000 },
    async (ctx, { flowDynamic, endFlow }) => {
        const phone = ctx.from;
        if (await isNewContact(botName, phone)) {
            const welcomeMessage = await getRandomWelcomeMessage();
            await addContact(botName, phone, welcomeMessage);
            await flowDynamic(welcomeMessage);
        }
        return endFlow();
    });
};

const setupAdminPortal = (botInstances, port) => {
    return new Promise((resolve, reject) => {
        const app = express();
        app.use(express.static(APP_PATH));
        app.use(express.static(path.join(APP_PATH, 'public')));
        app.use(bodyParser.json());
        app.use(bodyParser.urlencoded({ extended: true }));

        app.get('/instances', async (req, res) => {
            try {
                const instancesInfo = await Promise.all(botInstances.map(async (instance) => {
                    const contactsPath = path.join(QR_DIR, `${instance.name}_contacts.json`);
                    let contactCount = 0;
                    if (fs.existsSync(contactsPath)) {
                        const contactsData = await fsPromises.readFile(contactsPath, 'utf8');
                        const contacts = contactsData.trim() ? JSON.parse(contactsData) : [];
                        contactCount = contacts.length;
                    }
                    return {
                        name: instance.name,
                        status: instance.isConnected ? 'Connected' : 'Disconnected',
                        contactCount: contactCount
                    };
                }));
                res.json(instancesInfo);
            } catch (error) {
                console.error('Error getting instances info:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });        

        app.post('/instances', async (req, res) => {
            const { name } = req.body;
            try {
                const botConfig = await loadBotConfig();
                if (botConfig.instances.includes(name)) {
                    throw new Error(`Instance ${name} already exists`);
                }
                botConfig.instances.push(name);
                await saveBotConfig(botConfig);
                const instance = await createBotInstance(name);
                botInstances.push(instance);
                const instanceInfo = {
                    name: instance.name,
                    status: instance.isConnected ? 'Connected' : 'Disconnected',
                    contactCount: 0
                };
                res.json({ success: true, message: `Instance ${name} created successfully`, instance: instanceInfo });
                
            } catch (error) {
                res.status(400).json({ success: false, error: error.message });
            }
        });
    
        app.delete('/instances/:name', async (req, res) => {
            const { name } = req.params;
            try {
                const botConfig = await loadBotConfig();
                const index = botConfig.instances.indexOf(name);
                if (index === -1) {
                    throw new Error(`Instance ${name} does not exist`);
                }
                botConfig.instances.splice(index, 1);
                await saveBotConfig(botConfig);
                
                // Encuentra y elimina la instancia del array botInstances
                const instanceIndex = botInstances.findIndex(instance => instance.name === name);
                if (instanceIndex !== -1) {
                    const instance = botInstances[instanceIndex];
                    // Aquí deberías implementar la lógica para detener y limpiar la instancia del bot
                    // Por ejemplo: await instance.bot.stop();
                    botInstances.splice(instanceIndex, 1);
                }
    
                // Eliminar archivos asociados
                const qrPath = path.join(QR_DIR, `${name}.qr.png`);
                const dbPath = path.join(QR_DIR, `${name}_db.json`);
                const contactsPath = path.join(QR_DIR, `${name}_contacts.json`);
                const sessionsDir = path.join(QR_DIR, `${name}_sessions`);
    
                try {
                    if (fs.existsSync(qrPath)) fs.unlinkSync(qrPath);
                    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
                    if (fs.existsSync(contactsPath)) fs.unlinkSync(contactsPath);
                    if (fs.existsSync(sessionsDir)) {fs.rmSync(sessionsDir, { recursive: true });}
                } catch (error) {
                    console.error(`Error deleting files for instance ${name}:`, error);
                }

                const updatedInstances = Array.from(botInstances.values()).map(inst => ({
                    name: inst.name,
                    status: inst.isConnected ? 'Connected' : 'Disconnected',
                    contactCount: 0 // Implementar si es necesario
                }));
    
                res.json({ success: true, message: `Instance ${name} deleted successfully`, instances: updatedInstances });

            } catch (error) {
                res.status(400).json({ success: false, error: error.message });
            }
        });

        app.post('/instances/:botName/restart', async (req, res) => {
            const { botName } = req.params;
            const sessionsDir = path.join(QR_DIR, `${botName}_sessions`);
            console.log(`Attempting to restart instance: ${botName}`);
            
            try {
                // Eliminar la sesión si existe
                if (fs.existsSync(sessionsDir)) {
                    fs.rmSync(sessionsDir, { recursive: true });
                    console.log(`Sessions directory removed for ${botName}`);
                }
        
                // Actualizar el estado de la instancia
                const instance = botInstances.find(inst => inst.name === botName);
                if (instance) {
                    instance.isConnected = false;
                    instance.updateConnectionStatus(false);
                    console.log(`Instance ${botName} set to Disconnected.`);
                } else {
                    console.log(`Instance ${botName} not found in botInstances.`);
                }
        
                // Obtener la lista actualizada de instancias
                const updatedInstances = botInstances.map(inst => ({
                    name: inst.name,
                    status: inst.isConnected ? 'Connected' : 'Disconnected'
                }));
        
                res.json({ 
                    success: true, 
                    message: `Instance ${botName} restarted successfully`,
                    instances: updatedInstances
                });
            } catch (error) {
                console.error(`Error restarting instance ${botName}:`, error);
                res.status(500).json({ 
                    success: false, 
                    error: `Error restarting instance: ${error.message}`
                });
            }
        });

        app.get('/qr/:botName', (req, res) => {
            const botName = req.params.botName;
            const qrPath = path.join(QR_DIR, `${botName}.qr.png`);
            if (fs.existsSync(qrPath)) {
                const stats = fs.statSync(qrPath);
                res.setHeader('X-QR-Generated-Time', stats.mtime.toISOString());
                res.sendFile(qrPath);
            } else {
                res.status(404).send('QR code not available');
            }
        });

        app.get('/messages', async (req, res) => {
            const messages = await loadWelcomeMessages();
            res.json(messages);
        });

        app.post('/messages', async (req, res) => {
            const messages = await loadWelcomeMessages();
            messages.push(req.body.message);
            await saveWelcomeMessages(messages);
            res.json({ success: true });
        });

        app.put('/messages/:id', async (req, res) => {
            const messages = await loadWelcomeMessages();
            const id = parseInt(req.params.id);
            if (id >= 0 && id < messages.length) {
                messages[id] = req.body.message;
                await saveWelcomeMessages(messages);
                res.json({ success: true });
            } else {
                res.status(404).json({ success: false, error: 'Message not found' });
            }
        });

        app.delete('/messages/:id', async (req, res) => {
            const messages = await loadWelcomeMessages();
            const id = parseInt(req.params.id);
            if (id >= 0 && id < messages.length) {
                messages.splice(id, 1);
                await saveWelcomeMessages(messages);
                res.json({ success: true });
            } else {
                res.status(404).json({ success: false, error: 'Message not found' });
            }
        });

        app.get('/contacts/:botName', async (req, res) => {
            const botName = req.params.botName;
            const contactsPath = path.join(QR_DIR, `${botName}_contacts.json`);
            try {
                if (fs.existsSync(contactsPath)) {
                    const contactsData = await fsPromises.readFile(contactsPath, 'utf8');
                    const contacts = contactsData.trim() ? JSON.parse(contactsData) : [];
                    res.json(contacts);
                } else {
                    res.json([]);
                }
            } catch (error) {
                console.error('Error reading contacts file:', error);
                res.json([]);
            }
        });

        app.delete('/contacts/:botName/:phone', async (req, res) => {
            const { botName, phone } = req.params;
            const contactsPath = path.join(QR_DIR, `${botName}_contacts.json`);
            try {
                if (fs.existsSync(contactsPath)) {
                    let contacts = await loadContacts(botName);
                    contacts = contacts.filter(contact => contact.phone !== phone);
                    await saveContacts(botName, contacts);
                    res.json({ success: true, message: 'Contact deleted successfully' });
                } else {
                    res.status(404).json({ success: false, error: 'Contacts file not found' });
                }
            } catch (error) {
                console.error('Error deleting contact:', error);
                res.status(500).json({ success: false, error: 'Internal server error' });
            }
        });

        const server = app.listen(port, () => {
            console.log(`Admin portal running on http://localhost:${port}`);
            resolve(server);
        });

        server.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                reject(error);
            } else {
                console.error('Error en el servidor:', error);
            }
        });
    });
}

const createBotInstance = async (name) => {
    const adapterDB = new CustomMockAdapter(name)
    const adapterFlow = createFlow([createFlowForBot(name)])
    const adapterProvider = createProvider(BaileysProvider, {
        name: name,
        qrPath: path.join(QR_DIR, `${name}.qr.png`)
    })

    let instance = {
        name,
        bot: null,
        adapterProvider,
        isConnected: false,
        updateConnectionStatus: function(status) {
            this.isConnected = status;
            console.log(`Estado de conexión de ${this.name} actualizado a: ${status}`);
        }
    };

    adapterProvider.on('qr', () => {
        console.log(`Nuevo QR Code generado para ${name}`);
        instance.updateConnectionStatus(false);
    });

    adapterProvider.on('ready', () => {
        console.log(`Provider ${name} is ready`);
        instance.updateConnectionStatus(true);
    });

    adapterProvider.on('require_action', () => {
        console.log(`Provider ${name} is not ready`);
        instance.updateConnectionStatus(false);
    });

    instance.bot = await createBot({
        flow: adapterFlow,
        provider: adapterProvider,
        database: adapterDB,
    });

    return instance;
}

const main = async () => {
    try {
        console.log('Cargando configuración de bots...');
        const botConfig = await initializeBotConfig();
        console.log('Iniciando los bots...');
        const botInstances = await Promise.all(
            botConfig.instances.map(name => createBotInstance(name))
        );

        console.log('Configurando portal de administración...');
        let port = 3000;
        let server;

        const startServer = async () => {
            try {
                server = await setupAdminPortal(botInstances, port);
                console.log(`Bots y portal de administración iniciados correctamente en el puerto ${port}`);
            } catch (error) {
                if (error.code === 'EADDRINUSE') {
                    console.log(`Puerto ${port} en uso, intentando con el siguiente...`);
                    port++;
                    await startServer();
                } else {
                    throw error;
                }
            }
        };

        await startServer();

    } catch (error) {
        console.error('Error en la función main:', error);
    }
}

main().catch(error => {
    console.error('Error no capturado en main:', error);
});