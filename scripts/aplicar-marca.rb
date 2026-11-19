# Aplica a marca RevGás no Chatwoot (pode rodar de novo sem problema):
#   docker compose exec -T chatwoot bundle exec rails runner "$(cat scripts/aplicar-marca.rb)"
# Os arquivos de marca/ são servidos pelo próprio Chatwoot em /marca/ (volume no docker-compose.yml).
# Grava só configurações do núcleo open source (MIT); não usa código do plano Enterprise.

v = (Time.now.to_i).to_s # muda a URL a cada aplicação para o navegador não usar o CSS antigo do cache

{
  'INSTALLATION_NAME' => 'RevGás Atende',
  'BRAND_NAME' => 'RevGás',
  'BRAND_URL' => 'https://revgas.com',
  'LOGO' => '/marca/logo.png',
  'LOGO_DARK' => '/marca/logo-escuro.png',
  'LOGO_THUMBNAIL' => '/marca/icone.png',
  'DASHBOARD_SCRIPTS' => %(<link rel="stylesheet" href="/marca/tema.css?v=#{v}">)
}.each do |nome, valor|
  config = InstallationConfig.find_or_initialize_by(name: nome)
  config.value = valor
  config.locked = false
  config.save!
  puts "✓ #{nome}"
end

GlobalConfig.clear_cache
puts 'Marca aplicada. Recarregue o painel (Ctrl+F5).'
