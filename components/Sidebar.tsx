
import React from 'react';
import { 
  LayoutDashboard, 
  Megaphone, 
  Users, 
  Bot, 
  DollarSign, 
  Link2, 
  UserCircle,
  Calendar,
  LogOut,
  ExternalLink,
  ChevronRight
} from 'lucide-react';
import { AppSection } from '../types';
import { useApp } from '../App';

interface SidebarProps {
  activeSection: AppSection;
  onNavigate: (section: AppSection) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeSection, onNavigate }) => {
  const { logout } = useApp();

  const menuItems = [
    { id: AppSection.DASHBOARD, label: 'Visão Geral', icon: <LayoutDashboard size={18} /> },
    { id: AppSection.VENDAS, label: 'CRM & Vendas', icon: <Users size={18} /> },
    { id: AppSection.AGENDA, label: 'Agenda Médica', icon: <Calendar size={18} /> },
    { id: AppSection.FINANCEIRO, label: 'Gestão Financeira', icon: <DollarSign size={18} /> },
    { id: AppSection.MARKETING, label: 'Marketing', icon: <Megaphone size={18} /> },
    { id: AppSection.AUTOMACAO, label: 'Inteligência Artificial', icon: <Bot size={18} /> },
    { id: AppSection.INTEGRACAO, label: 'Conexões', icon: <Link2 size={18} /> },
  ];

  return (
    <div className="w-72 md:w-64 bg-[#0f172a] text-slate-300 h-full flex flex-col border-r border-white/5 shadow-2xl relative z-20">
      {/* Header */}
      <div className="p-8 pb-8 shrink-0">
        <div className="flex items-center gap-3 group cursor-pointer">
           <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-blue-900/50">
             <Bot size={18} />
           </div>
           <div>
             <h1 className="text-sm font-bold text-white tracking-wide">COPILOT AI</h1>
             <p className="text-[10px] text-slate-500 font-medium">Gestão & Crescimento</p>
           </div>
        </div>
      </div>
      
      {/* Navigation */}
      <nav className="flex-1 px-4 space-y-1 overflow-y-auto custom-scrollbar py-2">
        <p className="px-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 mt-2">Menu Principal</p>
        {menuItems.map((item) => {
          const isActive = activeSection === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`group w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-300 ease-out ${
                isActive 
                  ? 'bg-white/10 text-white shadow-lg backdrop-blur-sm border-l-2 border-blue-500' 
                  : 'hover:bg-white/5 hover:text-white text-slate-400 border-l-2 border-transparent'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className={`transition-colors duration-300 ${isActive ? 'text-blue-400' : 'text-slate-500 group-hover:text-slate-300'}`}>
                  {item.icon}
                </span>
                <span className="text-sm font-medium">{item.label}</span>
              </div>
              {isActive && <ChevronRight size={14} className="text-blue-400 animate-in slide-in-from-left-2 duration-300" />}
            </button>
          )
        })}
      </nav>

      {/* Footer Actions */}
      <div className="p-4 border-t border-white/5 space-y-2 shrink-0 bg-[#0b1121]">
        <button
          onClick={() => onNavigate(AppSection.PERFIL)}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
            activeSection === AppSection.PERFIL 
              ? 'bg-white/10 text-white' 
              : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <UserCircle size={18} />
          <span className="text-sm font-medium">Configurações</span>
        </button>

        <button
          onClick={() => logout()}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 group"
        >
          <LogOut size={18} className="group-hover:text-rose-400 transition-colors" />
          <span className="text-sm font-medium">Sair</span>
        </button>

        <div className="mt-4 flex justify-center gap-4 text-[10px] font-medium text-slate-600">
             <a href="#" className="hover:text-slate-400 transition-colors">Termos</a>
             <a href="#" className="hover:text-slate-400 transition-colors">Privacidade</a>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
