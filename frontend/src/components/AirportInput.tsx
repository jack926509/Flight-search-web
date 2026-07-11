"use client";

import { useEffect, useRef, useState } from "react";
import Fuse from "fuse.js";
import type { Airport } from "@/lib/api";

interface Props {
  label: string;
  value: string; // IATA code
  onChange: (iata: string) => void;
  id: string;
}

export default function AirportInput({ label, value, onChange, id }: Props) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Airport[]>([]);
  const fuseRef = useRef<Fuse<Airport> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listboxId = `${id}-listbox`;

  // Load airports.json once
  useEffect(() => {
    fetch("/airports.json")
      .then((r) => r.json())
      .then((data: Airport[]) => {
        fuseRef.current = new Fuse(data, {
          keys: ["iata", "name", "city", "country", "zh"],
          threshold: 0.3,
          minMatchCharLength: 1,
          includeScore: true,
        });
      })
      .catch(() => {});
  }, []);

  // Sync display when value changes externally (e.g. swap)
  useEffect(() => {
    setQuery(value);
  }, [value]);

  const search = (q: string) => {
    setQuery(q);
    if (!fuseRef.current || !q.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    const hits = fuseRef.current
      .search(q.trim())
      .slice(0, 8)
      .map((r) => r.item);
    setResults(hits);
    setOpen(hits.length > 0);
  };

  const select = (airport: Airport) => {
    setQuery(`${airport.iata} — ${airport.city}`);
    onChange(airport.iata);
    setOpen(false);
    setResults([]);
  };

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={wrapRef} className="relative flex-1 min-w-0">
      <label htmlFor={id} className="block text-xs font-medium text-gray-500 mb-1">
        {label}
      </label>
      <input
        id={id}
        type="text"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        value={query}
        onChange={(e) => search(e.target.value)}
        onFocus={() => query && search(query)}
        placeholder="機場代碼或城市"
        className="w-full px-3 py-3 border border-gray-300 rounded-lg text-sm bg-white
                   focus:border-accent focus:ring-1 focus:ring-accent outline-none
                   min-h-[44px]"
      />
      {open && results.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg
                     shadow-lg max-h-60 overflow-y-auto"
        >
          {results.map((apt) => (
            <li
              key={apt.iata}
              role="option"
              aria-selected={apt.iata === value}
              onClick={() => select(apt)}
              className="px-4 py-3 cursor-pointer hover:bg-blue-50 flex items-center gap-3
                         min-h-[44px]"
            >
              <span className="font-bold text-primary w-10 shrink-0">{apt.iata}</span>
              <span className="text-sm text-gray-700 truncate">
                {apt.zh ? `${apt.zh.split(" ")[0]}（${apt.city}）` : apt.city}
                {apt.name !== apt.city ? ` — ${apt.name}` : ""}
              </span>
              <span className="text-xs text-gray-400 ml-auto shrink-0">{apt.country}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
