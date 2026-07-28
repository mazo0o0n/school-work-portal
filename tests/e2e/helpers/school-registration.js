async function mockSchoolRegistrationApi(page){
  await mockPhoneVerificationApi(page);
  await page.route('**/api/schools/register', async route => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        school: {
          publicId: 'school-test-public-id',
          verificationStatus: 'unverified'
        },
        editToken: 'test-edit-token'
      })
    });
  });
}

async function mockPhoneVerificationConfig(page, phoneVerificationRequired){
  await page.route('**/api/register/verification-config', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ phoneVerificationRequired })
    });
  });
}

async function mockPhoneVerificationApi(page){
  await mockPhoneVerificationConfig(page, true);
  await page.route('**/api/register/send-whatsapp-code', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        status: 'code_sent',
        expiresInSeconds: 600,
        retryAfterSeconds: 60
      })
    });
  });
  await page.route('**/api/register/verify-whatsapp-code', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        status: 'verified',
        verificationToken: 'test-phone-verification-token',
        expiresInSeconds: 600
      })
    });
  });
}

async function completeRegistrationContact(page){
  await page.fill('#registrationContactPhone', '0500000000');
  await page.check('#registrationConsent');
  await page.click('#sendWhatsAppCode');
  await page.fill('#phoneVerificationCode', '123456');
  await page.click('#verifyWhatsAppCode');
  await page.locator('#phoneVerificationStatus.is-verified').waitFor();
}

module.exports = {
  completeRegistrationContact,
  mockPhoneVerificationConfig,
  mockPhoneVerificationApi,
  mockSchoolRegistrationApi
};
