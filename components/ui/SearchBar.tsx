import React from 'react';
import { Search, X } from 'lucide-react';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  value,
  onChange,
  placeholder = 'Search...',
  className = '',
}) => {
  return (
    <div className={`relative ${className}`}>
      <Search 
        size={18} 
        className="absolute left-3 top-1/2 -translate-y-1/2 text-[#666666]" 
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="
          w-full pl-10 pr-10 py-2.5
          bg-[#151515] border border-[#2a2a2a] rounded-lg
          text-white placeholder-[#666666]
          transition-all duration-150
          focus:outline-none focus:border-[#3b82f6] focus:ring-1 focus:ring-blue-500/30
        "
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="
            absolute right-3 top-1/2 -translate-y-1/2
            text-[#666666] hover:text-white
            transition-colors duration-150
          "
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
};

export default SearchBar;
