"use client";
import { useId, useState } from "react";
export const industries = [
  "Technology / Software Development",
  "Technology / IT Services",
  "Technology / SaaS",
  "Technology / Artificial Intelligence",
  "Technology / Cybersecurity",
  "Technology / Telecommunications",
  "Retail / E-commerce",
  "Retail / Consumer Goods",
  "Food & Beverage / Restaurants",
  "Food & Beverage / Cafes",
  "Food & Beverage / Manufacturing",
  "Healthcare / Clinics",
  "Healthcare / Pharmaceuticals",
  "Healthcare / Wellness",
  "Finance / Banking",
  "Finance / Insurance",
  "Finance / Accounting",
  "Finance / Fintech",
  "Education / Schools",
  "Education / Training",
  "Education / Edtech",
  "Real Estate / Residential",
  "Real Estate / Commercial",
  "Construction / Architecture",
  "Professional Services / Consulting",
  "Professional Services / Legal",
  "Marketing / Advertising",
  "Marketing / Design",
  "Media / Entertainment",
  "Media / Publishing",
  "Manufacturing / Industrial",
  "Manufacturing / Automotive",
  "Travel / Hospitality",
  "Travel / Tourism",
  "Transportation / Logistics",
  "Agriculture / Farming",
  "Energy / Utilities",
  "Energy / Renewables",
  "Fashion / Apparel",
  "Beauty / Personal Care",
  "Fitness / Sports",
  "Nonprofit / Community",
  "Government / Public Services",
  "Other",
];
export function IndustrySelect({
  value,
  onChange,
  label = "Industry",
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  const id = useId();
  const [other, setOther] = useState(value === "Other");
  return (
    <label className="field">
      <span>{label}</span>
      <input
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded="false"
        aria-controls={id}
        list={id}
        value={other ? "Other" : value}
        onChange={(e) => {
          setOther(e.target.value === "Other");
          onChange(e.target.value);
        }}
        placeholder="Search industries or enter your own"
        maxLength={150}
      />
      <datalist id={id}>
        {industries.map((industry) => (
          <option key={industry} value={industry} />
        ))}
      </datalist>
      <small>
        Search a sector or subcategory. Choose Other and enter your own
        industry.
      </small>
      {other && (
        <input
          aria-label="Custom industry"
          placeholder="Enter your industry"
          value={value === "Other" ? "" : value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus
        />
      )}
    </label>
  );
}
