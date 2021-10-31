/* eslint-disable no-ternary */
/* eslint-disable multiline-ternary */
/* eslint-disable lines-around-comment */
/* eslint-disable max-lines-per-function */
/* eslint-disable camelcase */
import express from 'express'
import axios from 'axios'
import fs from 'fs';

const app = express();

const apiUrl = 'https://api.box.com'
const numberPrefix = (process.env.numberPrefix) ? process.env.numberPrefix : "BOX"
const storagePath = (process.env.storagePath) ? process.env.storagePath : "./"
const fileName = "lastIssuedNumber.txt"

var server = app.listen(3000, () => {
    var host = server.address().address
    var port = server.address().port
 
    console.log("Box Document Numbering started and listening at http://%s:%s. Visit this address with your browser to start migrating", host, port)
})


app.get('/', (req, res) => {
    console.log("Starting")

    let fileId = req.query.fileId;
    const authCode = req.query.authCode
    const clientId = "f7jc1cw2jfy81s1ynd44a3at5qnx50of"
    const clientSecret = "7sfealHN1ePcucpsTQ66Hph3oBt97rRy"


    axios.request({
        url: `${apiUrl}/oauth2/token/`, 
        method: "post",
        data: `grant_type=authorization_code&client_id=${clientId}&client_secret=${clientSecret}&code=${authCode}`,
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
        }
    })
    .then(response => {
        console.log("Getting user details")
        let data = {
            accessToken: response.data.access_token
        }

        let options = {
            params: {
                fields: "name,enterprise"
            },
            headers: {
                Authorization: `Bearer ${data.accessToken}`
            }
        }

        return axios.get(`${apiUrl}/2.0/users/me/`,options)
        .then(subResponse => {
            data.username = subResponse.data.name
            data.enterpriseId = subResponse.data.enterprise.id
            return data

        })
        .catch(error => {
            console.log(error)
            return Promise.reject(new Error("Error reading your user details"))
        })
        
    })
    .then(data => {
        console.log("Issuing document number")

        return issueNumber()
        .then(response => {
            data.documentNumber = response
            return data
        })
        .catch(error => {
            console.log(error)
            return Promise.reject(new Error("Unable to issue number to apply."))
        })
    })
    .then(data => {
        console.log("Applying metadata")

        let options = {
            headers: {
                Authorization: `Bearer ${data.accessToken}`
            }
        }

        let attributes = {
            "generatedAt": (new Date()).toISOString(),
            "generatedBy": data.username,
            "number": data.documentNumber
        }
        return axios.post(`${apiUrl}/2.0/files/${fileId}/metadata/enterprise_${data.enterpriseId}/documentNumber`,attributes,options)
        .then(() => {
            return data
        })
        .catch(error => {
            if (error.response.status == 409) {
                return Promise.reject(new Error("This document already has a document number in its metadata. If you need to re-apply a document number, the metadata instance needs to be removed first."))                
            }
            console.log(error)
            return Promise.reject(new Error("Error applying metadata"))
        })
        
    })
    .then(data => {
        console.log("Getting file details")
        let options = {
            headers: {
                Authorization: `Bearer ${data.accessToken}`
            }
        }

        return axios.get(`${apiUrl}/2.0/files/${fileId}`,options)
        .then(response => {
            data.filename = response.data.name
            return data
        })
        .catch(error => {
            console.log(error)
            return Promise.reject(new Error("Unable to read document name"))
        })
    })
    .then(data => {
        console.log("Renaming file")
        
        let options = {
            headers: {
                Authorization: `Bearer ${data.accessToken}`
            }
        }

        let attributes = {
            "name": `${data.filename.replace(/((^\[.*\] )||(^))/,"[" + data.documentNumber + "] ")}`,
        }

        return axios.put(`${apiUrl}/2.0/files/${fileId}/`,attributes,options)
        .then(() => {
            return data
        })
        .catch(error => {
            console.log(error)
            return Promise.reject(new Error("Unable to rename document"))
        })
        
    })
    .then(data => {
        console.log("Invalidating token")
        return axios.request({
            url: `${apiUrl}/oauth2/revoke`, 
            method: "post",
            data: `client_id=${clientId}&client_secret=${clientSecret}&code=${authCode}&token=${data.accessToken}`,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
            }
        })
        .then(() => {
            return data
        })
        .catch(error => {
            console.log(error)
            return Promise.reject(new Error("Error finishing up while revoking token."))
        })

    })
    .then(data => {
        console.log("Returning success status")
        res.status(200).send(`Issued and applied document number ${data.documentNumber}`)
        
    })
    .catch(error => {
        console.log("Returning error to Box user: ", error.message)
        res.status(500).send(error.message)
        
    })
})


const issueNumber = () => {
    return new Promise((resolve, reject) => {
        console.log("Issuing number")
        readNumber()
        .then(number => {
            writeNumber(number)
            return number
        })
        .then((number) => {
            resolve(numberPrefix + (number + 1).toString().padStart(6,"0"))
        })
        .catch(error => {
            reject(error)
        })


    })
}

const readNumber = () => {
    return new Promise((resolve) => {
        console.log("Reading current number from storage")
        
        fs.promises.stat(`${storagePath}${fileName}`)
        .then(() => {
            return fs.promises.readFile(`${storagePath}${fileName}`)
            .then(buffer => {
                console.log("returning from existing file", buffer.toString());
                resolve(Number(buffer.toString()));
            })
        })
        .catch(error => {
            if (error.code == "ENOENT") {
                console.log("readNumber: Creating file")
                const initialNumber = 0
                return fs.promises.writeFile(`${storagePath}${fileName}`,initialNumber.toString())
                .then(() => {
                    resolve(initialNumber)
                })
                
            } 
            console.log(error)
            return Promise.reject(new Error("Error reading previous number"))
            
        })

    })
}

const writeNumber = (currentNumber) => {
    return new Promise((resolve, reject) => {
        console.log("Writing issued number to storage")

        const newNumber = Number(currentNumber) + 1

        fs.promises.writeFile(`${storagePath}${fileName}`,newNumber.toString())
        .then(() => {
            resolve()
        })
        .catch(error => {
            console.log(error)
            reject(new Error("Error writing issued number. This is an integity risk"))
        })

    })
}