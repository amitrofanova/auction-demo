export function reasonText(reason: string): string {
  switch (reason) {
    case 'not_integer':
      return 'Нужны целые числа'
    case 'below_min':
      return 'Начальная стоимость и шаг больше нуля'
    case 'bad_duration':
      return 'Длительность от 1 до 1440 минут'
    case 'wrong_stage':
      return 'Сейчас это действие недоступно'
    case 'not_seller':
      return 'Это может сделать только продавец'
    case 'bad_message':
      return 'Некорректное сообщение'
    default:
      return 'Команда отклонена'
  }
}