require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'MobileFilePicker'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.homepage       = package['repository']['url']
  s.license        = package['license']
  s.author         = package['author']
  s.platform       = :ios, '13.0'
  s.source         = { :git => package['repository']['url'] }
  s.source_files   = 'ios/Sources/MobileFilePicker/**/*.{swift,h,m}'
  s.dependency     'Tauri'
end
