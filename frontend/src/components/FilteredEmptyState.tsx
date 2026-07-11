"use client";

interface Props {
  onClear: () => void;
}

/** 篩選條件把當批結果全部濾掉時顯示，區分於「這天真的沒有航班」的空狀態 */
export default function FilteredEmptyState({ onClear }: Props) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <span className="text-3xl">🔍</span>
      <p className="text-sm text-gray-500">沒有符合篩選的航班，試著放寬條件</p>
      <button
        type="button"
        onClick={onClear}
        className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50
                   transition-colors min-h-[44px]"
      >
        清除篩選
      </button>
    </div>
  );
}
