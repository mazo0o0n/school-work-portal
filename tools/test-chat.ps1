param(
  [string]$BaseUrl = "http://127.0.0.1:4173"
)

$ErrorActionPreference = "Stop"
$testsPath = Join-Path $PSScriptRoot "..\tests\chat-smoke-tests.json"
$endpoint = "$($BaseUrl.TrimEnd('/'))/api/chat"

# BaseUrl must serve the real /api/chat endpoint. A static file server is not enough.
if (-not (Test-Path -LiteralPath $testsPath)) {
  Write-Error "Missing tests/chat-smoke-tests.json"
  exit 1
}

try {
  $tests = Get-Content -LiteralPath $testsPath -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
  Write-Error "Unable to read tests JSON."
  exit 1
}

$passed = 0
$failed = 0

foreach ($test in $tests) {
  $errors = [System.Collections.Generic.List[string]]::new()
  try {
    $body = @{ question = [string]$test.question } | ConvertTo-Json -Compress
    $response = Invoke-RestMethod -Uri $endpoint -Method Post -ContentType "application/json; charset=utf-8" -Body $body
    $answer = [string]$response.answer
    $source = [string]$response.source
    $isFallback = [bool]$response.notFound

    if ($null -ne $test.shouldFallback -and $isFallback -ne [bool]$test.shouldFallback) {
      $errors.Add("Unexpected fallback value")
    }
    if ($test.expectedSourceIncludes -and $source.IndexOf([string]$test.expectedSourceIncludes, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) {
      $errors.Add("Source does not include expected text")
    }
    if ($test.expectedAnswerIncludes -and $answer.IndexOf([string]$test.expectedAnswerIncludes, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) {
      $errors.Add("Answer does not include expected text")
    }
    if ($test.shouldNotInclude -and $answer.IndexOf([string]$test.shouldNotInclude, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
      $errors.Add("Answer includes forbidden text")
    }
    if ($test.expectedImages -eq $true) {
      $imageCount = @($response.images).Count
      if ($imageCount -lt 1) { $errors.Add("Expected image was not returned") }
    }
  } catch {
    $errors.Add("Request failed or /api/chat response was invalid")
  }

  if ($errors.Count -eq 0) {
    $passed++
    Write-Host "PASS  $($test.name)" -ForegroundColor Green
  } else {
    $failed++
    Write-Host "FAIL  $($test.name): $($errors -join '; ')" -ForegroundColor Red
  }
}

Write-Host "Result: $passed passed, $failed failed, $($tests.Count) total."
if ($failed -gt 0) { exit 1 }
