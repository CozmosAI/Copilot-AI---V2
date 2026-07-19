const fs = require('fs');

let content = fs.readFileSync('server.js', 'utf8');

// TASK 3: Adicionar a verificação inicial
const task3Search = `if (!lead.phone) {
            return res.status(400).json({ ok: false, error: "Lead não possui telefone para iniciar WhatsApp." });
        }`;

const task3Replace = `if (!lead.phone) {
            return res.status(400).json({ ok: false, error: "Lead não possui telefone para iniciar WhatsApp." });
        }

        // TAREFA 3: Se o lead já tem uma conversation_id ligada, usar ela imediatamente
        if (lead.conversation_id) {
            const { data: earlyConv } = await client
                .from('crm_conversations')
                .select(\`
                    *,
                    contact:crm_contacts(*)
                \`)
                .eq('id', lead.conversation_id)
                .maybeSingle();

            if (earlyConv && earlyConv.lead_id === lead.id) {
                const earlyContact = earlyConv.contact;
                delete earlyConv.contact;
                return res.status(200).json({ 
                    ok: true, 
                    contact: earlyContact, 
                    conversation: earlyConv, 
                    lead 
                });
            }
        }`;

content = content.replace(task3Search, task3Replace);

// TASK 1: Remover fallback legado
const task1Search = `            if (!contact) {
                // se não encontrar, buscar por user_id + phone antigo também para recuperar contatos criados antes da correção
                const phoneDigitsRaw = lead.phone.replace(/\\D/g, '');
                const { data: legacyContact } = await client
                    .from('crm_contacts')
                    .select('*')
                    .eq('user_id', user.id)
                    .eq('phone', phoneDigitsRaw)
                    .maybeSingle();

                if (legacyContact) {
                    contact = legacyContact;
                }
            }`;

content = content.replace(task1Search, '');


// TASK 2: Prevenir hijack
const task2Search = `        if (existingConv) {
            conversation = existingConv;
            
            // Garantir que a conversa ligue o lead, caso não esteja ligado ainda
            if (conversation.lead_id !== lead.id) {
                await client
                    .from('crm_conversations')
                    .update({
                        lead_id: lead.id,
                        conversation_status: 'open',
                        updated_at: new Date()
                    })
                    .eq('id', conversation.id);

                const { data: refreshedConversation } = await client
                    .from('crm_conversations')
                    .select('*')
                    .eq('id', conversation.id)
                    .maybeSingle();

                conversation = refreshedConversation || conversation;
            }
        }`;

const task2Replace = `        if (existingConv) {
            conversation = existingConv;
            
            // Se a conversa JÁ tem um lead_id DIFERENTE, NÃO sequestrar!
            // Criar uma nova conversa pro lead atual em vez de roubar a do outro lead
            if (existingConv.lead_id && existingConv.lead_id !== lead.id) {
                console.log(\`[CRM] Conversa \${existingConv.id} já pertence ao lead \${existingConv.lead_id}. Criando nova conversa pro lead \${lead.id}.\`);
                
                const { data: newConv, error: insertConvErr } = await client
                    .from('crm_conversations')
                    .insert({
                        user_id: user.id,
                        connection_id: activeConnection.id,
                        contact_id: contact.id,
                        lead_id: lead.id,
                        conversation_status: 'open',
                        unread_count: 0,
                        last_message_text: null,
                        last_message_type: null,
                        last_message_at: null,
                        last_sender: null,
                        created_at: new Date(),
                        updated_at: new Date()
                    })
                    .select()
                    .single();

                if (insertConvErr) throw insertConvErr;
                conversation = newConv;
            } else if (!existingConv.lead_id) {
                // Se a conversa NÃO tem lead_id, vincular com segurança
                await client
                    .from('crm_conversations')
                    .update({
                        lead_id: lead.id,
                        conversation_status: 'open',
                        updated_at: new Date()
                    })
                    .eq('id', conversation.id);
            }
            // Se existingConv.lead_id === lead.id, não fazer nada (já está vinculado corretamente)
        }`;

content = content.replace(task2Search, task2Replace);

fs.writeFileSync('server.js', content);
console.log("Patches aplicados com sucesso.");

