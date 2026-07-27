async function mockSchoolRegistrationApi(page){
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

async function completeRegistrationContact(page){
  await page.fill('#registrationContactPhone', '0500000000');
  await page.check('#registrationConsent');
}

module.exports = {
  completeRegistrationContact,
  mockSchoolRegistrationApi
};
