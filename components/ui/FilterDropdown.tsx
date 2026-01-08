import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

interface FilterOption {
  value: string;
  label: string;
}

interface FilterDropdownProps {
  label: string;
  options: FilterOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export const FilterDropdown: React.FC<FilterDropdownProps> = ({
  label,
  options,
  value,
  onChange,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = options.find(opt => opt.value === value);

  return (
    <div ref={dropdownRef} className={`relative ${className}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="
          flex items-center gap-2 px-4 py-2.5
          bg-[#151515] border border-[#2a2a2a] rounded-lg
          text-[#a0a0a0] hover:text-white hover:border-[#333333]
          transition-all duration-150
          min-w-[140px]
        "
      >
        <span className="flex-1 text-left text-sm">
          {selectedOption?.label || label}
        </span>
        <ChevronDown 
          size={16} 
          className={`transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div className="
          absolute top-full left-0 mt-1 w-full min-w-[180px]
          bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg
          shadow-lg shadow-black/50
          z-50 overflow-hidden
          animate-scale-in
        ">
          {options.map((option) => (
            <button
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              className={`
                w-full flex items-center gap-2 px-4 py-2.5
                text-sm text-left
                transition-colors duration-150
                ${option.value === value 
                  ? 'bg-[#252525] text-white' 
                  : 'text-[#a0a0a0] hover:bg-[#222222] hover:text-white'
                }
              `}
            >
              <span className="flex-1">{option.label}</span>
              {option.value === value && (
                <Check size={14} className="text-blue-400" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default FilterDropdown;
