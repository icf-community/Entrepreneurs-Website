// Company particulars on every email Foundry sends (Companies Act 2006;
// Company, LLP and Business (Names and Trading Disclosures) Regulations
// 2015). Added when the queue is drained, so mail queued from SQL (the
// connection digest) carries it as well as mail queued from the app.
export const COMPANY_LINE =
  "Foundry is run by IC Founders Ltd for Imperial Entrepreneurs. IC Founders Ltd is registered in England and Wales, " +
  "company number 17171277, registered office 71–75 Shelton Street, Covent Garden, London WC2H 9JQ.";

export function withCompanyFooter(text: string, html: string): { text: string; html: string } {
  return {
    text: `${text}\n\n--\n${COMPANY_LINE}\n`,
    html: `${html}\n<p style="color: #8a8885; font-size: 11px; line-height: 1.5; margin-top: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">${COMPANY_LINE}</p>`,
  };
}
