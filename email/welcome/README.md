# Welcome email

An editorial-style welcome email in a single 600px column, built from tables, with inline styles and system fonts. It stands alone: it does not use the Vezano Plus app's fonts or design tokens.

| File | Purpose |
| --- | --- |
| `email-template.html` | HTML template with `{{placeholder}}` tokens |
| `email-preview.html` | The same file filled with example values (MONO / Alex), to open in a browser |
| `email-plain.txt` | Plain-text body to send as the `text/plain` part |

## Placeholders

The HTML and plain-text files use the same tokens. Replace every one of them; none is optional.

| Placeholder | Where it appears | Example |
| --- | --- | --- |
| `{{brand_name}}` | `<title>`, header link, sign-off ("The … team"), footer | `MONO` |
| `{{brand_initial}}` | Large Georgia letter in the sign-off strip | `m` |
| `{{first_name}}` | "Hi …," greeting | `Alex` |
| `{{website_url}}` | Header brand link, footer "Visit website" | `https://example.com` |
| `{{dashboard_url}}` | "Open your dashboard" button | `https://example.com/dashboard` |
| `{{support_email}}` | `mailto:` links ("Talk to our team", "Get in touch") | `hello@example.com` |
| `{{preview_text}}` | Hidden preheader shown in inbox previews (HTML only) | `Your account is ready. Here's a good place to begin.` |

To regenerate the preview after you edit the template:

```bash
sed -e 's/{{brand_name}}/MONO/g' -e 's/{{brand_initial}}/m/g' -e 's/{{first_name}}/Alex/g' -e 's#{{website_url}}#https://example.com#g' -e 's#{{dashboard_url}}#https://example.com/dashboard#g' -e 's/{{support_email}}/hello@example.com/g' -e 's/{{preview_text}}/Your account is ready. Here\&rsquo;s a good place to begin./g' email-template.html > email-preview.html
```

## Integration notes

The template does plain string substitution and contains no logic. The sending code must make the values safe before they go in:

- **Escape dynamic text.** In the HTML part, escape `&`, `<`, `>`, `"` and `'` in `{{first_name}}`, `{{brand_name}}`, `{{brand_initial}}` and `{{preview_text}}`. A user-entered first name is untrusted input. Most template engines (Handlebars `{{ }}`, Jinja autoescape, Liquid `| escape`) do this by default. Never use raw or triple-brace output. Do not HTML-escape the plain-text part.
- **Validate URLs.** Only allow absolute `https://` URLs for `{{website_url}}` and `{{dashboard_url}}`. Reject `javascript:`, `data:` and anything else, then escape the value for use in an attribute (`&` becomes `&amp;`). Build these URLs on the server; never take them from user input.
- **Validate the support address.** `{{support_email}}` should be a fixed, plain address. Reject values containing `?`, `&`, spaces or line breaks so that nobody can add `cc=`, `subject=` or extra headers to the `mailto:` link.
- **Keep `{{brand_initial}}` to a single character.** The sign-off cell is 60px wide.
- **Use a short preheader.** Keep `{{preview_text}}` under about 90 characters. The invisible padding characters after it stop clients from pulling body text into the preview.
- Send the HTML and plain text together as `multipart/alternative`, and set the subject line in the sending code (for example "Welcome to {{brand_name}}").
- This email only links to the dashboard, the website and support. It contains no verification links, unsubscribe links or tracking. Add these in the sending layer if your product needs them (an unsubscribe header, for example, for marketing mail).

## Build notes

- Every layout element is a `role="presentation"` table. Essential styles are inline. The only `<style>` block holds one media query (`max-width: 620px`) that sets 12px outer padding, 26px side padding, a 48/49px headline and 46/42px hero padding, and stacks the header cells.
- An Outlook conditional (`<!--[if mso]>`) wraps the body in a fixed 600px table. The button uses `mso-padding-alt` so that Outlook still pads it. In other clients the padding sits on the `<a>`, so the whole button can be clicked.
- There is no JavaScript, flexbox, grid, forms, external CSS, web fonts or images. If a client strips the `<style>` block, the email keeps its desktop layout at full width inside a fluid 600px-max table, and every link still works.

## Testing done

The preview was checked in a Chromium-based browser at 1280px and 375px widths. It has **not** been tested in real email clients (Gmail web or app, Apple Mail, Outlook desktop or web), so run it through Litmus, Email on Acid or test sends before you use it in production. Outlook desktop in particular ignores `max-width` and depends on the conditional wrapper.
