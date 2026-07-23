
import React from 'react';
import { 
  LayoutDashboard, 
  Megaphone, 
  ShoppingCart,
  Users, 
  Bot, 
  DollarSign, 
  Link2, 
  UserCircle,
  Calendar,
  LogOut,
  ChevronRight,
  Mic,
  Cpu
} from 'lucide-react';
import { AppSection } from '../types';
import { useApp } from '../App';

// Logo AXIS (Triângulo Estilizado)
const AxisLogo = ({ size = 24, className = "" }: { size?: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className={className}>
    <path d="M12 2L2 21H7L12 11L17 21H22L12 2Z" />
  </svg>
);

interface SidebarProps {
  activeSection: AppSection;
  onNavigate: (section: AppSection) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeSection, onNavigate }) => {
  const { logout } = useApp();
  const [isCollapsed, setIsCollapsed] = React.useState(false);

  const menuItems = [
    { id: AppSection.DASHBOARD, label: 'Visão Geral', icon: <LayoutDashboard size={18} className="shrink-0" /> },
    { id: AppSection.AXIS, label: 'Axis AI', icon: <Cpu size={18} className="shrink-0" />, badge: 'Novo' },
    { id: AppSection.MARKETING, label: 'Marketing', icon: <Megaphone size={18} className="shrink-0" /> },
    { id: AppSection.MERCADO_LIVRE, label: 'Mercado Livre', icon: <ShoppingCart size={18} className="shrink-0" /> },
    { id: AppSection.VENDAS, label: 'CRM & Vendas', icon: <Users size={18} className="shrink-0" /> },
    { id: AppSection.AGENDA, label: 'Agenda Médica', icon: <Calendar size={18} className="shrink-0" /> },
    { id: AppSection.AUTOMACAO, label: 'Inteligência Artificial', icon: <Bot size={18} className="shrink-0" /> },
    { id: AppSection.FINANCEIRO, label: 'Gestão Financeira', icon: <DollarSign size={18} className="shrink-0" /> },
    { id: AppSection.INTEGRACAO, label: 'Conexões', icon: <Link2 size={18} className="shrink-0" /> },
    { id: AppSection.GRAVADOR, label: 'Gravador', icon: <Mic size={18} className="shrink-0" />, badge: 'Beta' },
  ];

  return (
    <div className={`bg-[#0f172a] text-slate-300 h-full flex flex-col border-r border-white/5 shadow-2xl relative z-20 transition-all duration-300 ease-in-out ${isCollapsed ? 'w-20' : 'w-72 md:w-64'}`}>
      
      {/* Toggle Button */}
      <button 
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="absolute -right-3 top-10 bg-[#0f172a] border border-white/10 rounded-full p-1 text-slate-400 hover:text-white hover:bg-white/5 z-30 transition-colors hidden md:flex"
      >
        <ChevronRight size={16} className={`transform transition-transform duration-300 ${isCollapsed ? '' : 'rotate-180'}`} />
      </button>

      {/* Header */}
      <div className={`p-8 shrink-0 transition-all duration-300 ${isCollapsed ? 'px-4 items-center flex flex-col' : 'pb-8'}`}>
        <div className={`flex items-center group cursor-pointer ${isCollapsed ? 'justify-center' : 'gap-3'}`}>
           <div className={`shrink-0 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-blue-900/50 transition-all duration-300 ${isCollapsed ? 'w-10 h-10' : 'w-10 h-10'}`}>
             <AxisLogo size={20} />
           </div>
           {!isCollapsed && (
             <div className="overflow-hidden min-w-[120px] transition-opacity duration-300 opacity-100">
               <h1 className="text-base font-bold text-white tracking-wide whitespace-nowrap">AXIS AI</h1>
               <p className="text-[10px] text-slate-500 font-medium tracking-wider uppercase whitespace-nowrap">Gestão Inteligente</p>
             </div>
           )}
        </div>
      </div>
      
      {/* Navigation */}
      <nav className={`flex-1 space-y-1 overflow-y-auto custom-scrollbar py-2 ${isCollapsed ? 'px-2' : 'px-4'}`}>
        {!isCollapsed && <p className="px-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 mt-2">Menu Principal</p>}
        {menuItems.map((item) => {
          const isActive = activeSection === item.id;
          const isAxis = item.id === AppSection.AXIS;
          
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              title={isCollapsed ? item.label : undefined}
              className={`group w-full flex items-center px-4 py-3 rounded-xl transition-all duration-300 ease-out ${isCollapsed ? 'justify-center' : 'justify-between'} ${
                isActive 
                  ? (isAxis ? 'bg-indigo-600/20 text-indigo-400 shadow-lg border-l-2 border-indigo-500' : 'bg-white/10 text-white shadow-lg backdrop-blur-sm border-l-2 border-blue-500') 
                  : 'hover:bg-white/5 hover:text-white text-slate-400 border-l-2 border-transparent'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className={`shrink-0 transition-colors duration-300 ${isActive ? (isAxis ? 'text-indigo-400' : 'text-blue-400') : 'text-slate-500 group-hover:text-slate-300'}`}>
                  {React.cloneElement(item.icon, { size: 18 })}
                </span>
                {!isCollapsed && <span className={`text-sm font-medium whitespace-nowrap truncate ${isAxis ? 'tracking-wider font-bold' : ''}`}>{item.label}</span>}
              </div>
              {!isCollapsed && (
                <div className="flex items-center gap-2 shrink-0">
                  {item.badge && (
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide border ${isAxis ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' : 'bg-blue-500/20 text-blue-300 border-blue-500/30'}`}>
                      {item.badge}
                    </span>
                  )}
                  {isActive && <ChevronRight size={14} className={isAxis ? 'text-indigo-400' : 'text-blue-400'} />}
                </div>
              )}
            </button>
          )
        })}
      </nav>

      {/* Footer Actions */}
      <div className={`p-4 border-t border-white/5 shrink-0 bg-[#0b1121] ${isCollapsed ? 'space-y-4 px-2' : 'space-y-2'}`}>
        <button
          onClick={() => onNavigate(AppSection.PERFIL)}
          title={isCollapsed ? "Configurações" : undefined}
          className={`w-full flex items-center px-4 py-3 rounded-xl transition-all duration-200 ${isCollapsed ? 'justify-center' : 'gap-3'} ${
            activeSection === AppSection.PERFIL 
              ? 'bg-white/10 text-white border-l-2 border-blue-500' 
              : 'text-slate-400 hover:text-white hover:bg-white/5 border-l-2 border-transparent'
          }`}
        >
          <UserCircle size={18} className="shrink-0" />
          {!isCollapsed && <span className="text-sm font-medium whitespace-nowrap">Configurações</span>}
        </button>

        <button
          onClick={() => logout()}
          title={isCollapsed ? "Sair" : undefined}
          className={`w-full flex items-center px-4 py-3 rounded-xl transition-all duration-200 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 group ${isCollapsed ? 'justify-center' : 'gap-3'} border-l-2 border-transparent`}
        >
          <LogOut size={18} className="shrink-0 group-hover:text-rose-400 transition-colors" />
          {!isCollapsed && <span className="text-sm font-medium whitespace-nowrap">Sair</span>}
        </button>

        {!isCollapsed && (
          <div className="mt-4 flex justify-center gap-4 text-[10px] font-medium text-slate-600 whitespace-nowrap">
               <a href="#" className="hover:text-slate-400 transition-colors">Termos</a>
               <a href="#" className="hover:text-slate-400 transition-colors">Privacidade</a>
          </div>
        )}
      </div>
    </div>
  );
};

export default Sidebar;
