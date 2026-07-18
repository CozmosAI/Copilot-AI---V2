
import React, { useState, useEffect, useRef } from 'react';
import { 
  User, Mail, Camera, Save, DollarSign, Phone, MapPin, 
  Stethoscope, Building2, Briefcase, Plus, Trash2, Crown, Users,
  Shield, CheckCircle2, AlertCircle, X, Loader2, Edit2, Sliders, Settings, Activity, FileText
} from 'lucide-react';
import { useApp } from '../App';
import { UserRole, CustomFieldDefinition, LifecycleStage } from '../types';

const generateKeyFromLabel = (label: string) => {
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/[^a-z0-9_]/g, '_') // replace non-alphanumeric with underscores
    .replace(/_+/g, '_') // collapse consecutive underscores
    .replace(/^_+|_+$/g, ''); // trim leading/trailing underscores
};

const Profile: React.FC = () => {
  const { user, updateUser, teamMembers, addTeamMember, removeTeamMember, aiConfig, updateAiConfig } = useApp();

  // Tab Switcher State
  const [activeTab, setActiveTab] = useState<'profile' | 'crm'>('profile');

  // CRM Configs States
  const [stages, setStages] = useState<LifecycleStage[]>([]);
  const [customFields, setCustomFields] = useState<CustomFieldDefinition[]>([]);
  const [loadingCRM, setLoadingCRM] = useState(false);

  // Lifecycle Stage Form States
  const [isAddingStage, setIsAddingStage] = useState(false);
  const [editingStage, setEditingStage] = useState<LifecycleStage | null>(null);
  const [stageKey, setStageKey] = useState('');
  const [stageLabel, setStageLabel] = useState('');
  const [stageColor, setStageColor] = useState('#3B82F6');
  const [stageSortOrder, setStageSortOrder] = useState(0);
  const [stageIsActive, setStageIsActive] = useState(true);

  // Custom Field Form States
  const [isAddingField, setIsAddingField] = useState(false);
  const [editingField, setEditingField] = useState<CustomFieldDefinition | null>(null);
  const [fieldKey, setFieldKey] = useState('');
  const [fieldLabel, setFieldLabel] = useState('');
  const [fieldType, setFieldType] = useState<'text' | 'number' | 'date' | 'select'>('text');
  const [fieldOptions, setFieldOptions] = useState('');
  const [fieldIsRequired, setFieldIsRequired] = useState(false);
  const [fieldSortOrder, setFieldSortOrder] = useState(0);
  const [showAdvancedField, setShowAdvancedField] = useState(false);

  const loadStages = async () => {
    if (!user?.id) return;
    try {
      setLoadingCRM(true);
      const { supabase } = await import('../lib/supabase');
      const { data, error } = await supabase.from('lifecycle_stages').select('*').eq('user_id', user.id).order('sort_order', { ascending: true });
      if (error) throw error;
      if (data) setStages(data);
    } catch (err) {
      console.error('Erro ao carregar estágios:', err);
    } finally {
      setLoadingCRM(false);
    }
  };

  const loadFields = async () => {
    if (!user?.id) return;
    try {
      const { supabase } = await import('../lib/supabase');
      const { data, error } = await supabase.from('custom_field_definitions').select('*').eq('user_id', user.id).order('sort_order', { ascending: true });
      if (error) throw error;
      if (data) setCustomFields(data);
    } catch (err) {
      console.error('Erro ao carregar campos personalizados:', err);
    }
  };

  const resetStageForm = () => {
    setStageKey('');
    setStageLabel('');
    setStageColor('#3B82F6');
    setStageSortOrder(stages.length);
    setStageIsActive(true);
  };

  const resetFieldForm = () => {
    setFieldKey('');
    setFieldLabel('');
    setFieldType('text');
    setFieldOptions('');
    setFieldIsRequired(false);
    setFieldSortOrder(customFields.length);
    setShowAdvancedField(false);
  };

  const handleEditStage = (stage: LifecycleStage) => {
    setEditingStage(stage);
    setIsAddingStage(true);
    setStageKey(stage.stage_key);
    setStageLabel(stage.stage_label);
    setStageColor(stage.stage_color);
    setStageSortOrder(stage.sort_order);
    setStageIsActive(stage.is_active);
  };

  const handleEditField = (field: CustomFieldDefinition) => {
    setEditingField(field);
    setIsAddingField(true);
    setFieldKey(field.field_key);
    setFieldLabel(field.field_label);
    setFieldType(field.field_type);
    setFieldOptions(Array.isArray(field.field_options) ? field.field_options.join('\n') : '');
    setFieldIsRequired(field.is_required);
    setFieldSortOrder(field.sort_order);
  };

  useEffect(() => {
    if (activeTab === 'crm' && user?.id) {
      loadStages();
      loadFields();
    }
  }, [activeTab, user?.id]);
  
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
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
      setAvatarUrl((user as any).avatar_url || null);
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

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Validações
    if (!file.type.startsWith('image/')) {
      alert('Por favor, selecione um arquivo de imagem.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('A imagem deve ter no máximo 5MB.');
      return;
    }
    
    setUploadingAvatar(true);
    try {
      const { supabase } = await import('../lib/supabase');
      const fileExt = file.name.split('.').pop();
      const fileName = `${user?.id}-${Date.now()}.${fileExt}`;
      const filePath = `${user?.id}/${fileName}`;
      
      // Upload pro Storage
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file, { cacheControl: '3600', upsert: true });
      
      if (uploadError) throw uploadError;
      
      // Obter URL pública
      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);
      
      // Atualizar profiles.avatar_url
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', user?.id);
      
      if (updateError) throw updateError;
      
      setAvatarUrl(publicUrl);
      // Atualizar contexto do App
      updateUser({ avatar_url: publicUrl } as any);
      alert('Foto de perfil atualizada com sucesso!');
    } catch (err: any) {
      console.error('Erro ao fazer upload:', err);
      alert('Erro ao atualizar foto: ' + (err.message || err));
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
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

      {/* TABS SELECTOR */}
      <div className="flex border-b border-slate-200 gap-6">
        <button
          onClick={() => setActiveTab('profile')}
          className={`pb-3 text-sm font-bold border-b-2 transition-all ${
            activeTab === 'profile'
              ? 'border-navy text-navy font-black'
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          Meu Perfil & Equipe
        </button>
        <button
          onClick={() => setActiveTab('crm')}
          className={`pb-3 text-sm font-bold border-b-2 transition-all ${
            activeTab === 'crm'
              ? 'border-navy text-navy font-black'
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          Configurações do CRM
        </button>
      </div>

      {activeTab === 'profile' && (
        <>
          {/* --- CARTÃO 1: PERFIL DO USUÁRIO --- */}
          <div className="bg-white rounded-[40px] border border-slate-200 shadow-sm overflow-hidden relative">
        
        {/* TOP BAR / COVER (Visual mais limpo) */}
        <div className="p-8 md:p-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 border-b border-slate-100 bg-slate-50/30">
            <div className="flex items-center gap-6">
                <div className="relative group">
                    <div className="w-24 h-24 rounded-3xl border-4 border-white shadow-xl overflow-hidden bg-slate-200">
                        <img 
                          src={avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(formData.name || 'User')}&background=0f172a&color=fff&size=128`} 
                          alt="Avatar" 
                          className="w-full h-full object-cover"
                        />
                    </div>
                    <button 
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingAvatar}
                      className="absolute -bottom-2 -right-2 p-2 bg-white rounded-xl shadow-md text-navy border border-slate-100 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Alterar foto de perfil"
                    >
                      {uploadingAvatar ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Camera size={16} />
                      )}
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleAvatarUpload}
                      className="hidden"
                    />
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
      </>
      )}

      {activeTab === 'crm' && (
        <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-300">
          
          {/* SEÇÃO: Automação */}
          <div className="bg-white rounded-[40px] border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-8 md:p-10 border-b border-slate-100 bg-slate-50/50">
              <h3 className="text-xl font-bold text-navy flex items-center gap-3">
                <Sliders size={24} className="text-slate-400"/> Automação
              </h3>
              <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1 ml-1">
                Configure os recursos automatizados da plataforma
              </p>
            </div>
            <div className="p-8 md:p-10">
              <div className="p-4 bg-white border border-slate-200 rounded-xl">
                <div className="flex items-center justify-between">
                  <div className="flex-1 pr-4">
                    <h4 className="text-sm font-bold text-navy">Score Automático de Leads</h4>
                    <p className="text-xs text-slate-500 mt-1">Ativa pontuação automática de leads (0-100) baseada em regras (recência, temperatura, valor potencial, dados preenchidos). Leads quentes (🔥), mornos (⚡) e frios (❄️) aparecem no Kanban e Dashboard.</p>
                  </div>
                  <button
                    onClick={() => updateAiConfig({ scoringEnabled: !aiConfig.scoringEnabled })}
                    className={`relative w-12 h-6 rounded-full transition-colors shrink-0 ${aiConfig.scoringEnabled ? 'bg-emerald-500' : 'bg-slate-300'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${aiConfig.scoringEnabled ? 'translate-x-6' : ''}`} />
                  </button>
                </div>
              </div>
            </div>
          </div>
          
          {/* SECÇÃO 1: ESTÁGIOS DO FUNIL */}
          <div className="bg-white rounded-[40px] border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-8 md:p-10 border-b border-slate-100 bg-slate-50/50 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h3 className="text-xl font-bold text-navy flex items-center gap-3">
                  <Activity size={24} className="text-slate-400"/> Estágios do Funil (CRM)
                </h3>
                <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1 ml-1">
                  Defina os estágios do ciclo de vida dos leads
                </p>
              </div>
              {!isAddingStage && (
                <button
                  onClick={() => { resetStageForm(); setEditingStage(null); setIsAddingStage(true); }}
                  className="bg-navy text-white px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest shadow-lg hover:bg-slate-800 transition-all flex items-center gap-2 self-start md:self-auto"
                >
                  <Plus size={16}/> Adicionar Estágio
                </button>
              )}
            </div>

            <div className="p-8 md:p-10">
              {isAddingStage && (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!stageKey || !stageLabel) return;
                    try {
                      const { supabase } = await import('../lib/supabase');
                      const payload = {
                        user_id: user?.id,
                        stage_key: stageKey.trim().toLowerCase(),
                        stage_label: stageLabel.trim(),
                        stage_color: stageColor,
                        sort_order: stageSortOrder,
                        is_active: stageIsActive
                      };
                      
                      let err;
                      if (editingStage) {
                        const { error } = await supabase.from('lifecycle_stages').update(payload).eq('id', editingStage.id);
                        err = error;
                      } else {
                        const { error } = await supabase.from('lifecycle_stages').insert([payload]);
                        err = error;
                      }
                      
                      if (err) throw err;
                      alert(editingStage ? 'Estágio atualizado!' : 'Estágio adicionado com sucesso!');
                      setIsAddingStage(false);
                      setEditingStage(null);
                      resetStageForm();
                      loadStages();
                    } catch (error: any) {
                      console.error(error);
                      alert('Erro ao salvar estágio: ' + (error.message || error));
                    }
                  }}
                  className="mb-8 p-6 bg-slate-50 rounded-3xl border border-slate-200 space-y-4 animate-in slide-in-from-top-4"
                >
                  <div className="flex justify-between items-center border-b border-slate-200/60 pb-3">
                    <h4 className="font-bold text-navy text-sm">{editingStage ? 'Editar Estágio' : 'Novo Estágio'}</h4>
                    <button
                      type="button"
                      onClick={() => { setIsAddingStage(false); setEditingStage(null); }}
                      className="p-1 hover:bg-slate-200 rounded-full transition-colors"
                    >
                      <X size={16} className="text-slate-400"/>
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Identificador (Key - único)</label>
                      <input
                        required
                        disabled={!!editingStage}
                        type="text"
                        placeholder="Ex: lead, agendou, procedimento"
                        value={stageKey}
                        onChange={e => setStageKey(e.target.value)}
                        className="w-full p-3 rounded-xl text-sm border border-slate-300 focus:outline-none focus:border-navy bg-white disabled:bg-slate-100 disabled:text-slate-400 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Nome do Estágio</label>
                      <input
                        required
                        type="text"
                        placeholder="Ex: Novo Lead, Procedimento Concluído"
                        value={stageLabel}
                        onChange={e => setStageLabel(e.target.value)}
                        className="w-full p-3 rounded-xl text-sm border border-slate-300 focus:outline-none focus:border-navy bg-white"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Cor do Badge</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={stageColor}
                          onChange={e => setStageColor(e.target.value)}
                          className="w-10 h-10 rounded-xl border border-slate-300 bg-white p-1 cursor-pointer"
                        />
                        <span className="text-sm font-mono font-semibold text-slate-600">{stageColor}</span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Ordem de Exibição</label>
                      <input
                        required
                        type="number"
                        placeholder="0"
                        value={stageSortOrder}
                        onChange={e => setStageSortOrder(Number(e.target.value))}
                        className="w-full p-3 rounded-xl text-sm border border-slate-300 focus:outline-none focus:border-navy bg-white"
                      />
                    </div>
                    <div className="flex items-center pt-6">
                      <label className="flex items-center gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={stageIsActive}
                          onChange={e => setStageIsActive(e.target.checked)}
                          className="w-4.5 h-4.5 text-navy border-slate-300 rounded focus:ring-navy"
                        />
                        <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Ativo</span>
                      </label>
                    </div>
                  </div>
                  <div className="flex justify-end gap-3 pt-4 border-t border-slate-200/60">
                    <button
                      type="button"
                      onClick={() => { setIsAddingStage(false); setEditingStage(null); }}
                      className="px-5 py-2.5 rounded-xl border border-slate-300 text-xs font-bold uppercase tracking-widest text-slate-500 hover:bg-slate-50 transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="bg-navy text-white px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest shadow-lg hover:bg-slate-800 transition-colors"
                    >
                      Salvar Estágio
                    </button>
                  </div>
                </form>
              )}

              {loadingCRM ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-2">
                  <Loader2 className="animate-spin" size={24} />
                  <span className="text-xs font-semibold">Carregando CRM...</span>
                </div>
              ) : (
                <div className="space-y-3">
                  {stages.map(stage => (
                    <div key={stage.id} className="flex items-center justify-between p-4 rounded-2xl border border-slate-100 hover:border-slate-300 transition-all bg-white shadow-sm">
                      <div className="flex items-center gap-3">
                        <span className="w-4 h-4 rounded-full border border-slate-200" style={{ backgroundColor: stage.stage_color }} />
                        <div>
                          <p className="text-sm font-bold text-navy">{stage.stage_label}</p>
                          <p className="text-xs text-slate-400 font-mono">key: {stage.stage_key} • ordem: {stage.sort_order}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-md border uppercase tracking-wider ${stage.is_active ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-slate-100 text-slate-400 border-slate-200'}`}>
                          {stage.is_active ? 'Ativo' : 'Inativo'}
                        </span>
                        <button
                          onClick={() => handleEditStage(stage)}
                          className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-blue-600 transition-colors"
                          title="Editar estágio"
                        >
                          <Edit2 size={14}/>
                        </button>
                        <button
                          onClick={async () => {
                            if (!confirm('Deseja realmente remover este estágio?')) return;
                            try {
                              const { supabase } = await import('../lib/supabase');
                              const { error } = await supabase.from('lifecycle_stages').delete().eq('id', stage.id);
                              if (error) throw error;
                              loadStages();
                            } catch (err: any) {
                              console.error(err);
                              alert('Erro ao excluir estágio: ' + (err.message || err));
                            }
                          }}
                          className="p-2 hover:bg-rose-50 rounded-lg text-slate-300 hover:text-rose-600 transition-colors"
                          title="Excluir estágio"
                        >
                          <Trash2 size={14}/>
                        </button>
                      </div>
                    </div>
                  ))}

                  {stages.length === 0 && (
                    <div className="text-center py-12 text-slate-300 border-2 border-dashed border-slate-100 rounded-3xl">
                      <p className="text-xs font-bold uppercase tracking-widest">Nenhum estágio do ciclo de vida definido</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* SECÇÃO 2: CAMPOS CUSTOMIZADOS */}
          <div className="bg-white rounded-[40px] border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-8 md:p-10 border-b border-slate-100 bg-slate-50/50 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h3 className="text-xl font-bold text-navy flex items-center gap-3">
                  <Sliders size={24} className="text-slate-400"/> Campos Personalizados
                </h3>
                <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1 ml-1">
                  Adicione perguntas ou informações específicas para preencher na ficha de cada lead
                </p>
              </div>
              <button
                onClick={() => { resetFieldForm(); setEditingField(null); setIsAddingField(true); }}
                className="bg-navy text-white px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest shadow-lg hover:bg-slate-800 transition-all flex items-center gap-2 self-start md:self-auto"
              >
                <Plus size={16}/> Adicionar Campo
              </button>
            </div>

            <div className="p-8 md:p-10">
              {/* MODAL DE CRIAÇÃO / EDIÇÃO DE CAMPO (OVERLAY REAL) */}
              {isAddingField && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                  <div className="bg-white w-full max-w-lg rounded-[32px] border border-slate-100 shadow-2xl p-8 space-y-6 animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
                    <div className="flex justify-between items-center border-b border-slate-100 pb-4">
                      <h4 className="font-extrabold text-2xl text-navy">
                        {editingField ? 'Editar Campo' : 'Novo Campo Personalizado'}
                      </h4>
                      <button
                        type="button"
                        onClick={() => { setIsAddingField(false); setEditingField(null); }}
                        className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                      >
                        <X size={18} className="text-slate-400"/>
                      </button>
                    </div>

                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (!fieldLabel) return;
                        try {
                          const { supabase } = await import('../lib/supabase');
                          let optionsArray = null;
                          if (fieldType === 'select') {
                            optionsArray = fieldOptions.split(/[\n,]+/).map(o => o.trim()).filter(o => o.length > 0);
                          }
                          
                          // Use standard snake_case field_key
                          const computedKey = editingField ? fieldKey : generateKeyFromLabel(fieldLabel);

                          const payload = {
                            user_id: user?.id,
                            field_key: computedKey,
                            field_label: fieldLabel.trim(),
                            field_type: fieldType,
                            field_options: optionsArray,
                            is_required: fieldIsRequired,
                            sort_order: fieldSortOrder
                          };
                          
                          let err;
                          if (editingField) {
                            const { error } = await supabase.from('custom_field_definitions').update(payload).eq('id', editingField.id);
                            err = error;
                          } else {
                            const { error } = await supabase.from('custom_field_definitions').insert([payload]);
                            err = error;
                          }
                          
                          if (err) throw err;
                          alert(editingField ? 'Campo atualizado!' : 'Campo personalizado adicionado com sucesso!');
                          setIsAddingField(false);
                          setEditingField(null);
                          resetFieldForm();
                          loadFields();
                        } catch (error: any) {
                          console.error(error);
                          alert('Erro ao salvar campo: ' + (error.message || error));
                        }
                      }}
                      className="space-y-6"
                    >
                      {/* Nome do Campo */}
                      <div className="space-y-2">
                        <label className="block text-xs font-black text-navy uppercase tracking-wider pl-1">Nome do Campo</label>
                        <input
                          required
                          type="text"
                          placeholder="Ex: CPF, Plano de Saúde, Convênio"
                          value={fieldLabel}
                          onChange={e => {
                            const val = e.target.value;
                            setFieldLabel(val);
                            if (!editingField) {
                              setFieldKey(generateKeyFromLabel(val));
                            }
                          }}
                          className="w-full p-4 rounded-2xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-navy focus:border-transparent outline-none text-sm font-semibold text-navy transition-all"
                        />
                      </div>

                      {/* Tipo de Resposta */}
                      <div className="space-y-2">
                        <label className="block text-xs font-black text-navy uppercase tracking-wider pl-1">Tipo de Resposta</label>
                        <select
                          value={fieldType}
                          onChange={e => setFieldType(e.target.value as any)}
                          className="w-full p-4 rounded-2xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-navy focus:border-transparent outline-none text-sm font-semibold text-navy transition-all"
                        >
                          <option value="text">✍️ Texto simples</option>
                          <option value="number">🔢 Número</option>
                          <option value="date">📅 Data</option>
                          <option value="select">📋 Lista de Opções</option>
                        </select>
                      </div>

                      {/* Se Lista de Opções, mostrar campo para adicionar opções */}
                      {fieldType === 'select' && (
                        <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-200 bg-slate-50 p-5 rounded-2xl border border-slate-100">
                          <label className="block text-xs font-black text-navy uppercase tracking-wider">Opções da Lista</label>
                          <p className="text-[11px] text-slate-400 font-medium mb-1">Escreva uma opção por linha para sua equipe escolher na ficha do lead.</p>
                          <textarea
                            required
                            rows={4}
                            placeholder="Particular&#10;Bradesco&#10;Unimed&#10;SulAmérica"
                            value={fieldOptions}
                            onChange={e => setFieldOptions(e.target.value)}
                            className="w-full p-4 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-navy focus:border-transparent outline-none text-sm font-semibold text-navy transition-all resize-none"
                          />
                        </div>
                      )}

                      {/* Campo Obrigatório? Checkbox */}
                      <div className="flex items-center pt-2">
                        <label className="flex items-center gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={fieldIsRequired}
                            onChange={e => setFieldIsRequired(e.target.checked)}
                            className="w-5 h-5 text-navy border-slate-300 rounded focus:ring-navy cursor-pointer transition-all"
                          />
                          <div>
                            <span className="block text-xs font-black text-navy uppercase tracking-wider">Campo obrigatório?</span>
                            <span className="block text-[10px] text-slate-400 font-medium">Impede salvar o lead se este campo estiver em branco</span>
                          </div>
                        </label>
                      </div>

                      {/* Ações */}
                      <div className="flex justify-end gap-3 pt-6 border-t border-slate-100">
                        <button
                          type="button"
                          onClick={() => { setIsAddingField(false); setEditingField(null); }}
                          className="px-5 py-3 rounded-2xl border border-slate-300 text-xs font-bold uppercase tracking-widest text-slate-500 hover:bg-slate-50 transition-colors"
                        >
                          Cancelar
                        </button>
                        <button
                          type="submit"
                          className="bg-navy text-white px-6 py-3 rounded-2xl font-bold text-xs uppercase tracking-widest shadow-lg hover:bg-slate-800 transition-colors"
                        >
                          Salvar
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}

              {/* LISTA DE CAMPOS CADASTRADOS */}
              <div className="space-y-3">
                {customFields.map(field => (
                  <div key={field.id} className="flex items-center justify-between p-4 rounded-2xl border border-slate-100 hover:border-slate-300 transition-all bg-white shadow-sm">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-slate-50 rounded-xl border border-slate-100 text-slate-500">
                        <FileText size={18} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold text-navy">{field.field_label}</p>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                            {field.field_type === 'text' && 'Texto simples'}
                            {field.field_type === 'number' && 'Número'}
                            {field.field_type === 'date' && 'Data'}
                            {field.field_type === 'select' && 'Lista de Opções'}
                          </span>
                          {field.is_required && (
                            <span className="text-[10px] font-black px-2 py-0.5 rounded bg-rose-50 text-rose-500 border border-rose-100">
                              Obrigatório
                            </span>
                          )}
                        </div>
                        {field.field_type === 'select' && Array.isArray(field.field_options) && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {field.field_options.map(opt => (
                              <span key={opt} className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 uppercase border border-blue-100/50">{opt}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleEditField(field)}
                        className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-blue-600 transition-colors"
                        title="Editar campo"
                      >
                        <Edit2 size={14}/>
                      </button>
                      <button
                        onClick={async () => {
                          if (!confirm('Deseja realmente remover este campo personalizado?')) return;
                          try {
                            const { supabase } = await import('../lib/supabase');
                            const { error } = await supabase.from('custom_field_definitions').delete().eq('id', field.id);
                            if (error) throw error;
                            loadFields();
                          } catch (err: any) {
                            console.error(err);
                            alert('Erro ao excluir campo personalizado: ' + (err.message || err));
                          }
                        }}
                        className="p-2 hover:bg-rose-50 rounded-lg text-slate-300 hover:text-rose-600 transition-colors"
                        title="Excluir campo"
                      >
                        <Trash2 size={14}/>
                      </button>
                    </div>
                  </div>
                ))}

                {customFields.length === 0 && (
                  <div className="text-center py-12 text-slate-300 border-2 border-dashed border-slate-100 rounded-3xl">
                    <p className="text-xs font-bold uppercase tracking-widest">
                      Nenhum campo personalizado. Crie campos como CPF, Convênio, Procedimento...
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>
      )}

    </div>
  );
};

export default Profile;
