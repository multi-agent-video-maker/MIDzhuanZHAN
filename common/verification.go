package common

import (
	"crypto/subtle"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

type verificationValue struct {
	code           string
	time           time.Time
	failedAttempts int
}

const (
	EmailVerificationPurpose = "v"
	PasswordResetPurpose     = "r"
	registrationCodeCooldown = 30 * time.Second
	registrationCodeAttempts = 5
)

var verificationMutex sync.Mutex
var verificationMap map[string]verificationValue
var verificationMapMaxSize = 10
var VerificationValidMinutes = 10

func GenerateVerificationCode(length int) string {
	code := uuid.New().String()
	code = strings.Replace(code, "-", "", -1)
	if length == 0 {
		return code
	}
	return code[:length]
}

func RegisterVerificationCodeWithKey(key string, code string, purpose string) {
	verificationMutex.Lock()
	defer verificationMutex.Unlock()
	verificationMap[purpose+key] = verificationValue{
		code: code,
		time: time.Now(),
	}
	if len(verificationMap) > verificationMapMaxSize {
		removeExpiredPairs()
	}
}

func VerifyCodeWithKey(key string, code string, purpose string) bool {
	verificationMutex.Lock()
	defer verificationMutex.Unlock()
	value, okay := verificationMap[purpose+key]
	now := time.Now()
	if !okay || int(now.Sub(value.time).Seconds()) >= VerificationValidMinutes*60 {
		return false
	}
	return code == value.code
}

// SendRegistrationCode reserves the recipient's cooldown before delivery and
// activates the code only after the mail provider accepts the message.
func SendRegistrationCode(email string, deliver func(string) error) (bool, error) {
	key := EmailVerificationPurpose + email
	now := time.Now()
	verificationMutex.Lock()
	if previous, exists := verificationMap[key]; exists && now.Sub(previous.time) < registrationCodeCooldown {
		verificationMutex.Unlock()
		return false, nil
	}
	if len(verificationMap) > verificationMapMaxSize {
		removeExpiredPairs()
	}
	verificationMap[key] = verificationValue{time: now}
	verificationMutex.Unlock()

	code := GenerateVerificationCode(6)
	if err := deliver(code); err != nil {
		return false, err
	}
	digest := GenerateHMAC("registration-code:" + email + "\x00" + code)
	verificationMutex.Lock()
	defer verificationMutex.Unlock()
	if verificationMap[key].time != now {
		return false, nil
	}
	verificationMap[key] = verificationValue{code: digest, time: now}
	return true, nil
}

func CheckRegistrationCode(email, code string) bool {
	return verifyRegistrationCode(email, code, false)
}

func ConsumeRegistrationCode(email, code string) bool {
	return verifyRegistrationCode(email, code, true)
}

func verifyRegistrationCode(email, code string, consume bool) bool {
	key := EmailVerificationPurpose + email
	digest := GenerateHMAC("registration-code:" + email + "\x00" + code)
	verificationMutex.Lock()
	defer verificationMutex.Unlock()
	value := verificationMap[key]
	if value.code == "" || time.Since(value.time) >= time.Duration(VerificationValidMinutes)*time.Minute {
		return false
	}
	if subtle.ConstantTimeCompare([]byte(value.code), []byte(digest)) == 1 {
		if consume {
			verificationMap[key] = verificationValue{time: value.time}
		}
		return true
	}
	value.failedAttempts++
	if value.failedAttempts >= registrationCodeAttempts {
		value.code = ""
	}
	verificationMap[key] = value
	return false
}

func DeleteKey(key string, purpose string) {
	verificationMutex.Lock()
	defer verificationMutex.Unlock()
	delete(verificationMap, purpose+key)
}

// no lock inside, so the caller must lock the verificationMap before calling!
func removeExpiredPairs() {
	now := time.Now()
	for key := range verificationMap {
		if int(now.Sub(verificationMap[key].time).Seconds()) >= VerificationValidMinutes*60 {
			delete(verificationMap, key)
		}
	}
}

func init() {
	verificationMutex.Lock()
	defer verificationMutex.Unlock()
	verificationMap = make(map[string]verificationValue)
}
