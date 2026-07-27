import React, { useState, useRef, useEffect } from 'react';
import { Calendar as CalendarIcon, ChevronDown, ChevronLeft, ChevronRight, Check } from 'lucide-react';

export interface DateRangeSelection {
  preset: string; // 'today' | 'yesterday' | '7d' | '30d' | '90d' | 'this_month' | 'last_month' | 'custom';
  from: Date;
  to: Date;
  compareWithPrevious: boolean;
}

interface DateRangePickerProps {
  value: DateRangeSelection;
  onChange: (selection: DateRangeSelection) => void;
}

export function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [tempPreset, setTempPreset] = useState(value.preset);
  const [tempFrom, setTempFrom] = useState<Date>(value.from);
  const [tempTo, setTempTo] = useState<Date>(value.to);
  const [compare, setCompare] = useState<boolean>(value.compareWithPrevious);

  // Month views for dual calendar
  const [currentMonthDate, setCurrentMonthDate] = useState<Date>(new Date(value.to));
  const popoverRef = useRef<HTMLDivElement>(null);

  // Sync state when props change
  useEffect(() => {
    setTempPreset(value.preset);
    setTempFrom(value.from);
    setTempTo(value.to);
    setCompare(value.compareWithPrevious);
  }, [value]);

  // Close popover when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Presets definition
  const presets = [
    { id: 'today', label: 'Hoje' },
    { id: 'yesterday', label: 'Ontem' },
    { id: '7d', label: 'Últimos 7 dias' },
    { id: '30d', label: 'Últimos 30 dias' },
    { id: '90d', label: 'Últimos 90 dias' },
    { id: 'this_month', label: 'Mês atual' },
    { id: 'last_month', label: 'Mês passado' },
    { id: 'custom', label: 'Personalizado' },
  ];

  const handleSelectPreset = (presetId: string) => {
    const now = new Date();
    let from = new Date();
    let to = new Date();

    switch (presetId) {
      case 'today':
        from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
        break;
      case 'yesterday':
        from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        to = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59);
        break;
      case '7d':
        from = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
        to = now;
        break;
      case '30d':
        from = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
        to = now;
        break;
      case '90d':
        from = new Date(now.getTime() - 89 * 24 * 60 * 60 * 1000);
        to = now;
        break;
      case 'this_month':
        from = new Date(now.getFullYear(), now.getMonth(), 1);
        to = now;
        break;
      case 'last_month':
        from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
        break;
      case 'custom':
      default:
        // keep current tempFrom & tempTo
        from = tempFrom;
        to = tempTo;
        break;
    }

    setTempPreset(presetId);
    setTempFrom(from);
    setTempTo(to);
  };

  const handleApply = () => {
    onChange({
      preset: tempPreset,
      from: tempFrom,
      to: tempTo,
      compareWithPrevious: compare,
    });
    setIsOpen(false);
  };

  // Format label for button pill
  const formatDateShort = (d: Date) => {
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
  };

  const getButtonText = () => {
    const foundPreset = presets.find((p) => p.id === value.preset);
    const label = foundPreset ? foundPreset.label : 'Personalizado';
    return `${label} (${formatDateShort(value.from)} — ${formatDateShort(value.to)})`;
  };

  // Calendar rendering logic
  const prevMonthDate = new Date(currentMonthDate.getFullYear(), currentMonthDate.getMonth() - 1, 1);

  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfWeek = (year: number, month: number) => {
    return new Date(year, month, 1).getDay();
  };

  const handleDateClick = (date: Date) => {
    if (tempPreset !== 'custom') {
      setTempPreset('custom');
      setTempFrom(date);
      setTempTo(date);
    } else {
      if (date < tempFrom) {
        setTempFrom(date);
      } else {
        setTempTo(date);
      }
    }
  };

  const isSelected = (date: Date) => {
    const dStr = date.toISOString().split('T')[0];
    const fromStr = tempFrom.toISOString().split('T')[0];
    const toStr = tempTo.toISOString().split('T')[0];
    return dStr === fromStr || dStr === toStr;
  };

  const isInRange = (date: Date) => {
    return date > tempFrom && date < tempTo;
  };

  const renderMonthGrid = (year: number, month: number) => {
    const totalDays = getDaysInMonth(year, month);
    const startDay = getFirstDayOfWeek(year, month);
    const monthName = new Date(year, month, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

    const days = [];
    // Blank slots before first day
    for (let i = 0; i < startDay; i++) {
      days.push(<div key={`blank-${i}`} className="h-8 w-8" />);
    }

    for (let d = 1; d <= totalDays; d++) {
      const date = new Date(year, month, d);
      const selected = isSelected(date);
      const inRange = isInRange(date);

      days.push(
        <button
          key={d}
          type="button"
          onClick={() => handleDateClick(date)}
          className={`h-8 w-8 rounded-lg text-xs font-medium transition-all flex items-center justify-center
            ${selected ? 'bg-slate-900 text-white font-bold shadow-xs' : ''}
            ${inRange && !selected ? 'bg-blue-50 text-blue-900' : ''}
            ${!selected && !inRange ? 'hover:bg-slate-100 text-slate-700' : ''}
          `}
        >
          {d}
        </button>
      );
    }

    return (
      <div className="w-56 space-y-2">
        <div className="text-xs font-bold text-slate-800 capitalize text-center">
          {monthName}
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-slate-400 uppercase">
          <span>Dom</span>
          <span>Seg</span>
          <span>Ter</span>
          <span>Qua</span>
          <span>Qui</span>
          <span>Sex</span>
          <span>Sáb</span>
        </div>
        <div className="grid grid-cols-7 gap-1">{days}</div>
      </div>
    );
  };

  return (
    <div className="relative inline-block text-left" ref={popoverRef}>
      {/* Botão Pill Branco */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="bg-white hover:bg-slate-50 border border-slate-200/90 shadow-2xs rounded-full px-4 py-2 text-xs font-semibold text-slate-800 flex items-center gap-2 transition-all focus:outline-none focus:ring-2 focus:ring-slate-900/10"
      >
        <CalendarIcon size={14} className="text-slate-500" />
        <span className="capitalize">{getButtonText()}</span>
        <ChevronDown size={14} className={`text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Popover */}
      {isOpen && (
        <div className="absolute right-0 mt-2 z-50 bg-white border border-slate-200 shadow-xl rounded-2xl p-4 w-[620px] max-w-[95vw] text-slate-900 space-y-4 animate-in fade-in zoom-in-95 duration-150">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            {/* Esquerda: Presets */}
            <div className="md:col-span-4 border-b md:border-b-0 md:border-r border-slate-100 pr-0 md:pr-3 space-y-1">
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider px-2 mb-2">Período</div>
              {presets.map((p) => {
                const isActive = tempPreset === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleSelectPreset(p.id)}
                    className={`w-full text-left px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center justify-between ${
                      isActive ? 'bg-slate-900 text-white font-semibold' : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span>{p.label}</span>
                    {isActive && <Check size={14} className="text-white shrink-0" />}
                  </button>
                );
              })}
            </div>

            {/* Direita: Calendários Lado a Lado */}
            <div className="md:col-span-8 space-y-3">
              <div className="flex items-center justify-between px-1">
                <button
                  type="button"
                  onClick={() => setCurrentMonthDate(new Date(currentMonthDate.getFullYear(), currentMonthDate.getMonth() - 1, 1))}
                  className="p-1 rounded-md hover:bg-slate-100 text-slate-600"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="text-xs font-bold text-slate-700">Selecione o intervalo</span>
                <button
                  type="button"
                  onClick={() => setCurrentMonthDate(new Date(currentMonthDate.getFullYear(), currentMonthDate.getMonth() + 1, 1))}
                  className="p-1 rounded-md hover:bg-slate-100 text-slate-600"
                >
                  <ChevronRight size={16} />
                </button>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                {renderMonthGrid(prevMonthDate.getFullYear(), prevMonthDate.getMonth())}
                {renderMonthGrid(currentMonthDate.getFullYear(), currentMonthDate.getMonth())}
              </div>
            </div>
          </div>

          {/* Footer: Checkbox Comparar + Botões Ação */}
          <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={compare}
                onChange={(e) => setCompare(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
              />
              <span>Comparar com período anterior</span>
            </label>

            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleApply}
                className="px-4 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 shadow-sm"
              >
                Aplicar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
