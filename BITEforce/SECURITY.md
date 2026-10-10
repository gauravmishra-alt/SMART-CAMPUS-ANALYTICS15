# Security checklist before production

This project is a starter implementation and has not undergone an independent security audit. Before storing real student data:

- [ ] Generate unique production secrets and set a strict CORS origin.
- [ ] Put the API behind TLS; configure secure cookies and trusted proxy handling.
- [ ] Add/verify MFA for privileged roles and account recovery controls.
- [ ] Configure institution email delivery and short-lived invitation activation.
- [ ] Integrate malware scanning and strict private object storage policies for uploads.
- [ ] Configure retention schedules, student export/correction/anonymization workflows, consent/legal basis, and institutional privacy notice.
- [ ] Add external log aggregation with PII redaction, alerting, rate limits, and incident response.
- [ ] Review tenant isolation with negative tests for every API endpoint and every role.
- [ ] Perform dependency scanning, SAST/DAST, penetration testing, load testing, backup/restore drills, and disaster recovery exercises.
- [ ] Check AI provider terms and institutional policy before enabling hosted AI. Never enable automatic decisions about grades, discipline, risk labels, or placement outcomes.
