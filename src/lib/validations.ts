import { z } from "zod";
export const authSchema = z
  .object({
    name: z.string(),
    email: z.email("Enter a valid email address."),
    password: z.string().min(8, "Use at least 8 characters."),
    confirm: z.string(),
    terms: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.confirm && value.password !== value.confirm)
      ctx.addIssue({
        code: "custom",
        path: ["confirm"],
        message: "Passwords do not match.",
      });
  });
export const websiteSchema = z
  .url("Enter a full URL, such as https://yourbrand.com.")
  .refine((url) => /^https?:\/\//i.test(url), "Use an http or https URL.");
export function validBrand(name: string, description: string) {
  return name.trim().length >= 2 && description.trim().length >= 10;
}
