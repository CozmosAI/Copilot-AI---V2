
import React, { useState, useEffect } from 'react';
import { 
  User, Mail, Camera, Save, DollarSign, Phone, MapPin, 
  Stethoscope, Building2, Briefcase, Plus, Trash2, Crown, Users,
  Shield, CheckCircle2, AlertCircle, X
} from 'lucide-react';
import { useApp } from '../App';
import { UserRole } from '../types';

const Profile: React.FC = () => {
  const { user, updateUser, teamMembers, addTeamMember, removeTeamMember } = useApp();
  
  // States - Dados Pessoais e Profissionais
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    clinic: '',
    specialty: '',
    procedures: '',
    city: '',
    ticketValue: 0
  });

  // States - Gestão de Equipe
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [newMember, setNewMember] = useState({ name: '', email: '', role: 'member' as UserRole });

  useEffect(() => {
    if (user) {
      setFormData({
        name: user.name || '',
        email: user.email || '',
        phone: user.phone || '',
        clinic: user.clinic || '',
        specialty: user.specialty || '',
        procedures: user.procedures || '',
        city: user.city || '',
        ticketValue: user.ticketValue || 0
      });
    }
  }, [user]);

  const handleSaveProfile = () => {
    updateUser({
      name: formData.name,
      clinic: formData.clinic,
      ticketValue: formData.ticketValue,
      phone: formData.phone,
      specialty: formData.specialty,
      procedures: formData.procedures,
      city: formData.city
    });
    alert('Perfil atualizado com sucesso!');
  };

  const handleAddMember = (e: React.FormEvent) => {
    e.preventDefault();
    if (teamMembers.length >= 2) {
      alert("Limite de 2 membros adicionais atingido.");
      return;
    }
    if (!newMember.name || !newMember.email) return;

    addTeamMember(newMember);
    setShowInviteForm(false);
    setNewMember({ name: '', email: '', role: 'member' });
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-in fade-in pb-20">
      
      {/* HEADER */}
      <header className="flex flex-col md:flex-row md:justify-between md:items-end gap-4 mb-2">
        <div>
          <h2 className="text-3xl font-extrabold text-navy tracking-tight">Perfil & Configurações</h2>
          <p className="text-slate-500 font-medium mt-1">Gerencie suas informações e controle de acesso.</p>
        </div>
      </header>

      {/* --- CARTÃO 1: PERFIL DO USUÁRIO --- */}
      <div className="bg-white rounded-[40px] border border-slate-200 shadow-sm overflow-hidden relative">
        
        {/* TOP BAR / COVER (Visual mais limpo) */}
        <div className="p-8 md:p-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 border-b border-slate-100 bg-slate-50/30">
            <div className="flex items-center gap-6">
                <div className="relative group">
                    <div className="w-24 h-24 rounded-3xl border-4 border-white shadow-xl overflow-hidden bg-slate-200">
                        <img src={`https://ui-avatars.com/api/?name=${formData.name}&background=0f172a&color=fff&size=128`} alt="Avatar" className="w-full h-full object-cover" />
                    </div>
                    <button className="absolute -bottom-2 -right-2 p-2 bg-white rounded-xl shadow-md text-navy border border-slate-100 hover:bg-slate-50 transition-colors">
                        <Camera size={16} />
                    </button>
                </div>
                <div>
                    <h3 className="text-2xl font-bold text-navy">{formData.name || 'Doutor(a)'}</h3>
                    <p className="text-sm text-slate-500 font-medium">{formData.email}</p>
                    <span className="inline-block mt-2 px-3 py-1 rounded-lg bg-blue-50 text-blue-700 text-[10px] font-black uppercase tracking-widest border border-blue-100">
                        Plano {user?.plan === 'pro' ? 'Profissional' : 'Gratuito'}
                    </span>
                </div>
            </div>
            
            <button onClick={handleSaveProfile} className="bg-navy text-white px-8 py-3.5 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-navy/20 hover:bg-slate-800 transition-all flex items-center gap-2 hover:scale-[1.02]">
                <Save size={18} /> Salvar Alterações
            </button>
        </div>

        <div className="p-8 md:p-10 space-y-10">
            {/* SEÇÃO: DADOS PESSOAIS */}
            <section>
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 bg-slate-100 rounded-xl text-slate-500"><User size={20}/></div>
                    <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">Dados Pessoais</h3>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                        <label className="text-[11px] font-black text-navy uppercase tracking-wider pl-1">Nome Completo</label>
                        <input 
                            type="text" 
                            value={formData.name} 
                            onChange={(e) => setFormData({...formData, name: e.target.value})} 
                            className="w-full p-4 rounded-2xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-navy focus:border-transparent outline-none text-sm font-semibold text-navy transition-all placeholder:text-slate-300"
                            placeholder="Seu nome"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-[11px] font-black text-navy uppercase tracking-wider pl-1">E-mail (Login)</label>
                        <div className="relative opacity-70">
                            <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"/>
                            <input 
                                type="email" 
                                value={formData.email} 
                                readOnly 
                                className="w-full pl-12 pr-4 py-4 rounded-2xl border border-slate-200 bg-slate-100 text-slate-500 cursor-not-allowed text-sm font-semibold" 
                            />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <label className="text-[11px] font-black text-navy uppercase tracking-wider pl-1">Telefone / WhatsApp</label>
                        <div className="relative">
                            <Phone size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"/>
                            <input 
                                type="tel" 
                                value={formData.phone} 
                                onChange={(e) => setFormData({...formData, phone: e.target.value})} 
                                className="w-full pl-12 pr-4 py-4 rounded-2xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-navy focus:border-transparent outline-none text-sm font-semibold text-navy transition-all" 
                                placeholder="(00) 00000-0000" 
                            />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <label className="text-[11px] font-black text-navy uppercase tracking-wider pl-1">Cidade(s) de Atendimento</label>
                        <div className="relative">
                            <MapPin size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"/>
                            <input 
                                type="text" 
                                value={formData.city} 
                                onChange={(e) => setFormData({...formData, city: e.target.value})} 
                                className="w-full pl-12 pr-4 py-4 rounded-2xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-navy focus:border-transparent outline-none text-sm font-semibold text-navy transition-all" 
                                placeholder="Ex: São Paulo" 
                            />
                        </div>
                    </div>
                </div>
            </section>

            <div className="h-px bg-slate-100 w-full"></div>

            {/* SEÇÃO: DADOS PROFISSIONAIS */}
            <section>
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 bg-slate-100 rounded-xl text-slate-500"><Briefcase size={20}/></div>
                    <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">Dados Profissionais</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                        <label className="text-[11px] font-black text-navy uppercase tracking-wider pl-1">Nome da Clínica</label>
                        <div className="relative">
                            <Building2 size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"/>
                            <input 
                                type="text" 
                                value={formData.clinic} 
                                onChange={(e) => setFormData({...formData, clinic: e.target.value})} 
                                className="w-full pl-12 pr-4 py-4 rounded-2xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-navy focus:border-transparent outline-none text-sm font-semibold text-navy transition-all" 
                                placeholder="Nome do consultório"
                            />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <label className="text-[11px] font-black text-navy uppercase tracking-wider pl-1">Especialidade Médica</label>
                        <div className="relative">
                            <Stethoscope size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"/>
                            <input 
                                type="text" 
                                value={formData.specialty} 
                                onChange={(e) => setFormData({...formData, specialty: e.target.value})} 
                                className="w-full pl-12 pr-4 py-4 rounded-2xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-navy focus:border-transparent outline-none text-sm font-semibold text-navy transition-all" 
                                placeholder="Ex: Dermatologia" 
                            />
                        </div>
                    </div>
                    <div className="md:col-span-2 space-y-2">
                        <label className="text-[11px] font-black text-navy uppercase tracking-wider pl-1">Procedimentos Realizados</label>
                        <textarea 
                            value={formData.procedures} 
                            onChange={(e) => setFormData({...formData, procedures: e.target.value})} 
                            className="w-full p-4 rounded-2xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-navy focus:border-transparent outline-none text-sm font-semibold text-navy transition-all h-24 resize-none" 
                            placeholder="Ex: Harmonização, Botox, Laser CO2 (Separe por vírgulas)" 
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-[11px] font-black text-navy uppercase tracking-wider pl-1">Valor da Consulta (Ticket)</label>
                        <div className="relative">
                            <DollarSign size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"/>
                            <input 
                                type="number" 
                                value={formData.ticketValue} 
                                onChange={(e) => setFormData({...formData, ticketValue: Number(e.target.value)})} 
                                className="w-full pl-12 pr-4 py-4 rounded-2xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-navy focus:border-transparent outline-none text-sm font-semibold text-navy transition-all" 
                            />
                        </div>
                        <p className="text-[10px] text-slate-400 font-medium px-2 italic">Usado para estimativas financeiras automáticas.</p>
                    </div>
                </div>
            </section>
        </div>
      </div>

      {/* --- CARTÃO 2: GESTÃO DE EQUIPE --- */}
      <div className="bg-white rounded-[40px] border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-8 md:p-10 border-b border-slate-100 bg-slate-50/50 flex flex-col md:flex-row md:items-center justify-between gap-4">
             <div>
                <h3 className="text-xl font-bold text-navy flex items-center gap-3"><Users size={24} className="text-slate-400"/> Minha Equipe</h3>
                <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1 ml-1">Gerencie o acesso à plataforma</p>
             </div>
             
             <div className="flex items-center gap-3">
                 <span className={`text-[10px] font-black px-3 py-1.5 rounded-xl border ${teamMembers.length >= 2 ? 'bg-rose-50 text-rose-500 border-rose-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'}`}>
                    {teamMembers.length}/2 VAGAS PREENCHIDAS
                 </span>
                 {!showInviteForm && (
                    <button onClick={() => setShowInviteForm(true)} disabled={teamMembers.length >= 2} className="bg-navy text-white px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest shadow-lg hover:bg-slate-800 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                       <Plus size={16}/> Adicionar
                    </button>
                 )}
             </div>
          </div>

          <div className="p-8 md:p-10">
             {showInviteForm && (
                <div className="mb-8 p-6 bg-slate-50 rounded-3xl border border-slate-200 animate-in slide-in-from-top-4">
                    <div className="flex justify-between items-center mb-4">
                        <h4 className="font-bold text-navy text-sm">Convidar Novo Membro</h4>
                        <button onClick={() => setShowInviteForm(false)} className="p-1 hover:bg-slate-200 rounded-full transition-colors"><X size={16} className="text-slate-400"/></button>
                    </div>
                    <form onSubmit={handleAddMember} className="flex flex-col md:flex-row gap-4">
                       <input autoFocus required type="text" placeholder="Nome" value={newMember.name} onChange={e => setNewMember({...newMember, name: e.target.value})} className="flex-1 p-3 rounded-xl text-sm border border-slate-300 focus:outline-none focus:border-navy" />
                       <input required type="email" placeholder="E-mail" value={newMember.email} onChange={e => setNewMember({...newMember, email: e.target.value})} className="flex-1 p-3 rounded-xl text-sm border border-slate-300 focus:outline-none focus:border-navy" />
                       <select value={newMember.role} onChange={e => setNewMember({...newMember, role: e.target.value as any})} className="p-3 rounded-xl text-sm border border-slate-300 focus:outline-none focus:border-navy bg-white min-w-[140px]">
                          <option value="member">Membro</option>
                          <option value="admin">Administrador</option>
                       </select>
                       <button type="submit" className="bg-emerald-500 text-white px-6 py-3 rounded-xl text-sm font-bold shadow-md hover:bg-emerald-600 transition-colors">Enviar</button>
                    </form>
                </div>
             )}

             <div className="space-y-4">
                 {/* OWNER */}
                 <div className="flex items-center gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-100 opacity-90">
                    <div className="w-10 h-10 rounded-full bg-navy text-white flex items-center justify-center text-sm font-bold border-2 border-white shadow-sm shrink-0">
                       {user?.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                       <p className="text-sm font-bold text-navy truncate">{user?.name} (Você)</p>
                       <p className="text-xs text-slate-400 truncate">{user?.email}</p>
                    </div>
                    <span className="text-[10px] font-black text-navy bg-white px-3 py-1 rounded-lg border border-slate-200 uppercase tracking-wider">Proprietário</span>
                 </div>

                 {/* MEMBERS */}
                 {teamMembers.map(member => (
                    <div key={member.id} className="flex items-center gap-4 p-4 rounded-2xl border border-slate-100 hover:border-slate-300 transition-all group relative bg-white">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold border-2 border-white shadow-sm shrink-0 ${member.role === 'admin' ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
                           {member.name.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                           <p className="text-sm font-bold text-navy truncate">{member.name}</p>
                           <p className="text-xs text-slate-400 truncate">{member.email}</p>
                        </div>
                        <div className="flex items-center gap-4">
                           <span className={`text-[10px] font-black px-3 py-1 rounded-lg border uppercase tracking-wider ${member.role === 'admin' ? 'bg-indigo-50 text-indigo-600 border-indigo-100' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                              {member.role === 'admin' ? 'Administrador' : 'Membro'}
                           </span>
                           <button onClick={() => removeTeamMember(member.id)} className="text-slate-300 hover:text-rose-500 transition-colors p-2 hover:bg-rose-50 rounded-lg">
                               <Trash2 size={16}/>
                           </button>
                        </div>
                    </div>
                 ))}

                 {teamMembers.length === 0 && (
                    <div className="text-center py-8 text-slate-300 border-2 border-dashed border-slate-100 rounded-2xl">
                       <p className="text-xs font-bold uppercase tracking-widest">Nenhum membro na equipe</p>
                    </div>
                 )}
             </div>

             <div className="mt-8 bg-blue-50/50 p-6 rounded-3xl border border-blue-100/50">
                <h4 className="text-xs font-black text-blue-800 mb-4 flex items-center gap-2 uppercase tracking-widest"><Shield size={14}/> Permissões de Acesso</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex gap-3 items-start">
                        <div className="mt-0.5"><Crown size={14} className="text-indigo-600"/></div>
                        <div>
                           <strong className="block text-xs font-bold text-indigo-700">Administrador</strong>
                           <p className="text-[10px] leading-relaxed text-slate-500 mt-1">Acesso total a todas as funções, incluindo financeiro, marketing e configurações globais.</p>
                        </div>
                    </div>
                    <div className="flex gap-3 items-start">
                        <div className="mt-0.5"><User size={14} className="text-slate-500"/></div>
                        <div>
                           <strong className="block text-xs font-bold text-slate-600">Membro</strong>
                           <p className="text-[10px] leading-relaxed text-slate-500 mt-1">Acesso operacional: CRM, Agenda e IA. <span className="text-rose-500 font-bold">Sem acesso</span> a dados sensíveis financeiros.</p>
                        </div>
                    </div>
                </div>
             </div>
          </div>
      </div>

    </div>
  );
};

export default Profile;
